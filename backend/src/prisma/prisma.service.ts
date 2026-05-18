import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { decryptField, encryptField } from '../common/services/field-encryption';

/**
 * Models and string fields that hold special-category personal data and must
 * be encrypted at rest (GDPR Art. 9 / KDPA s.44-46). The middleware below
 * intercepts every read/write against these models so the rest of the
 * codebase keeps using plain string assignments.
 */
const ENCRYPTED_FIELDS: Record<string, ReadonlyArray<string>> = {
  // GDPR Art. 9 / KDPA s.44-46: health data must be encrypted at rest.
  // All string fields below are encrypted by the write middleware and
  // decrypted transparently on read. Add new fields here — never inline.
  Claim:         ['diagnosis', 'treatment', 'rejectionReason'],
  OcrExtraction: ['diagnosis', 'memberName', 'patientName'],
};

type AnyObject = Record<string, any>;

function encryptWritePayload(model: string, data: AnyObject | undefined | null): void {
  if (!data || typeof data !== 'object') return;
  const fields = ENCRYPTED_FIELDS[model];
  if (!fields) return;
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string') {
      data[field] = encryptField(value);
    } else if (value && typeof value === 'object' && typeof value.set === 'string') {
      // Prisma update form: { field: { set: '…' } }
      value.set = encryptField(value.set);
    }
  }
}

function decryptRow(model: string, row: AnyObject | undefined | null): void {
  if (!row || typeof row !== 'object') return;
  const fields = ENCRYPTED_FIELDS[model];
  if (!fields) return;
  for (const field of fields) {
    const value = row[field];
    if (typeof value === 'string') {
      row[field] = decryptField(value);
    }
  }
}

function decryptResult(model: string, result: any): any {
  if (result == null) return result;
  if (Array.isArray(result)) {
    for (const row of result) decryptRow(model, row);
  } else {
    decryptRow(model, result);
  }
  return result;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    // Prisma 5 still supports $use; we use it (rather than $extends) because
    // it intercepts on the same client instance, so the rest of the codebase
    // can keep calling `prisma.claim.findMany(...)` without changes.
    this.$use(async (params, next) => {
      const model = params.model;
      if (model && ENCRYPTED_FIELDS[model]) {
        const action = params.action;
        if (action === 'create' || action === 'update') {
          encryptWritePayload(model, params.args?.data);
        } else if (action === 'upsert') {
          encryptWritePayload(model, params.args?.create);
          encryptWritePayload(model, params.args?.update);
        } else if (action === 'updateMany' || action === 'createMany') {
          // createMany accepts data: T | T[]
          const d = params.args?.data;
          if (Array.isArray(d)) d.forEach(row => encryptWritePayload(model, row));
          else encryptWritePayload(model, d);
        }
      }
      const result = await next(params);
      if (model && ENCRYPTED_FIELDS[model]) return decryptResult(model, result);
      return result;
    });
  }

  async onModuleInit() {
    await this.$connect();
    console.log('Database connected');
    // Validate encryption key at startup so mis-configured deployments fail
    // loudly rather than producing a 500 on the first claim with a diagnosis
    // or treatment value. DATA_ENCRYPTION_KEY must be 64 lowercase hex chars
    // (openssl rand -hex 32). Render's generateValue does not guarantee this
    // format — set it manually in the Render dashboard.
    const dek = process.env.DATA_ENCRYPTION_KEY;
    if (!dek || !/^[0-9a-f]{64}$/i.test(dek)) {
      console.error(
        '[startup] DATA_ENCRYPTION_KEY is missing or not a 64-char hex string. ' +
        'Generate one with: openssl rand -hex 32  and set it in the Render dashboard. ' +
        'Claims with diagnosis/treatment fields will 500 until this is fixed.',
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
