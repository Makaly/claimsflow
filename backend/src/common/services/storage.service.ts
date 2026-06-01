import { Injectable, Logger } from '@nestjs/common';
import { S3Client, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Document storage abstraction. When S3-compatible object storage is configured
 * (env), uploaded documents are persisted to the bucket and served from it, so
 * they survive container restarts (Render's local disk is ephemeral). When it
 * is not configured, everything stays on local disk — the historical behaviour.
 *
 * Stored references:
 *   - object storage → `s3://<key>`
 *   - local disk      → the absolute/relative filesystem path (unchanged)
 * Reads branch on the `s3://` prefix, so documents created before object storage
 * was enabled keep reading from disk while new ones come from the bucket — no
 * data migration required.
 *
 * Provider-agnostic: a custom `S3_ENDPOINT` makes the same client work with AWS
 * S3, Cloudflare R2 and Backblaze B2.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket = process.env.S3_BUCKET || '';
  private static readonly PREFIX = 's3://';

  constructor() {
    const enabled =
      (process.env.STORAGE_BACKEND || '').toLowerCase() === 's3' &&
      !!this.bucket &&
      !!process.env.S3_ACCESS_KEY_ID &&
      !!process.env.S3_SECRET_ACCESS_KEY;

    if (!enabled) {
      this.client = null;
      this.logger.log('Object storage disabled — using local disk for documents.');
      return;
    }
    this.client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || undefined, // set for R2/B2
      forcePathStyle: !!process.env.S3_ENDPOINT,       // required by R2/MinIO-style endpoints
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
    this.logger.log(`Object storage enabled (bucket: ${this.bucket}).`);
  }

  /** True when object storage is configured. */
  get isEnabled(): boolean {
    return this.client !== null;
  }

  /** True when a stored ref points at object storage rather than local disk. */
  private isRemote(ref: string): boolean {
    return ref.startsWith(StorageService.PREFIX);
  }

  private keyOf(ref: string): string {
    return ref.slice(StorageService.PREFIX.length);
  }

  /**
   * Persist a file. With object storage on, uploads `key` and returns
   * `s3://<key>`; otherwise returns `localPath` unchanged (caller keeps the file
   * on disk). `localPath` is the file already written by multer/the pipeline.
   */
  async put(key: string, localPath: string, contentType?: string): Promise<string> {
    if (!this.client) return localPath;
    const body = fs.createReadStream(localPath);
    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
    }).done();
    return `${StorageService.PREFIX}${key}`;
  }

  /** Whether the referenced object/file exists. */
  async exists(ref: string): Promise<boolean> {
    if (this.client && this.isRemote(ref)) {
      try {
        await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.keyOf(ref) }));
        return true;
      } catch {
        return false;
      }
    }
    return fs.existsSync(ref);
  }

  /** A readable stream of the referenced object/file, for serving to clients. */
  async getStream(ref: string): Promise<Readable> {
    if (this.client && this.isRemote(ref)) {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.keyOf(ref) }));
      return out.Body as Readable;
    }
    return fs.createReadStream(ref);
  }

  /**
   * Returns a local filesystem path for the ref, downloading the object to a
   * temp file first when it lives in object storage. Used by the processing
   * pipeline (watermark/OCR/merge) which needs a real local path. Caller may
   * delete the returned temp file when done (only created for remote refs).
   */
  async toLocalFile(ref: string): Promise<string> {
    if (!this.client || !this.isRemote(ref)) return ref;
    const key = this.keyOf(ref);
    const tmp = path.join(os.tmpdir(), `cf-${Date.now()}-${path.basename(key)}`);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(tmp);
      (out.Body as Readable).pipe(ws).on('finish', () => resolve()).on('error', reject);
    });
    return tmp;
  }

  /** Best-effort delete of the referenced object/file. */
  async delete(ref: string): Promise<void> {
    try {
      if (this.client && this.isRemote(ref)) {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.keyOf(ref) }));
      } else if (fs.existsSync(ref)) {
        fs.unlinkSync(ref);
      }
    } catch (e) {
      this.logger.warn(`delete failed for ${ref}: ${(e as Error)?.message}`);
    }
  }
}
