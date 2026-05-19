import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ImagePreprocessorService } from './image-preprocessor.service';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function makeJsonResponse(payload: any, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'ERR',
    json: async () => payload,
  } as unknown as Response;
}

describe('ImagePreprocessorService', () => {
  let tmpRoot: string;
  let prevCwd: string;
  let prevUrl: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'preproc-test-'));
    prevCwd = process.cwd();
    process.chdir(tmpRoot);
    prevUrl = process.env.ML_SIDECAR_URL;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (prevUrl === undefined) delete process.env.ML_SIDECAR_URL;
    else process.env.ML_SIDECAR_URL = prevUrl;
    globalThis.fetch = originalFetch;
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns null when ML_SIDECAR_URL is unset (sidecar disabled)', async () => {
    delete process.env.ML_SIDECAR_URL;
    const svc = new ImagePreprocessorService();
    const inputPath = path.join(tmpRoot, 'in.png');
    fs.writeFileSync(inputPath, TINY_PNG);

    const result = await svc.preprocess('doc-1', inputPath, 'image/png');
    expect(result).toBeNull();
  });

  it('rejects unsupported mime types (PDFs must be rendered first)', async () => {
    process.env.ML_SIDECAR_URL = 'http://sidecar:8000';
    const svc = new ImagePreprocessorService();
    const inputPath = path.join(tmpRoot, 'in.pdf');
    fs.writeFileSync(inputPath, Buffer.from('%PDF-1.4 fake'));

    await expect(svc.preprocess('doc-2', inputPath, 'application/pdf'))
      .rejects.toThrow(/does not accept application\/pdf/);
  });

  it('returns null and stays silent when sidecar is unreachable', async () => {
    process.env.ML_SIDECAR_URL = 'http://sidecar:8000';
    globalThis.fetch = (() => Promise.reject(new Error('ECONNREFUSED'))) as any;
    const svc = new ImagePreprocessorService();
    const inputPath = path.join(tmpRoot, 'in.png');
    fs.writeFileSync(inputPath, TINY_PNG);

    const result = await svc.preprocess('doc-3', inputPath, 'image/png', { force: true });
    expect(result).toBeNull();
  });

  it('returns null when sidecar responds with non-2xx', async () => {
    process.env.ML_SIDECAR_URL = 'http://sidecar:8000';
    globalThis.fetch = (() =>
      Promise.resolve(makeJsonResponse({ error: 'oh no' }, false, 503))) as any;
    const svc = new ImagePreprocessorService();
    const inputPath = path.join(tmpRoot, 'in.png');
    fs.writeFileSync(inputPath, TINY_PNG);

    const result = await svc.preprocess('doc-4', inputPath, 'image/png', { force: true });
    expect(result).toBeNull();
  });

  it('writes the preprocessed PNG and returns metadata on success', async () => {
    process.env.ML_SIDECAR_URL = 'http://sidecar:8000';
    const sidecarPayload = {
      imageBase64: TINY_PNG.toString('base64'),
      filename: 'in.png',
      originalWidth: 1,
      originalHeight: 1,
      finalWidth: 2550,
      finalHeight: 3300,
      deskewAngleDegrees: 1.23,
      wasCroppedToPage: true,
      dpiScaleRatio: 2.0,
      targetDpi: 300,
      stepsApplied: ['grayscale', 'deskew:1.23deg', 'cropToPage', 'clahe', 'denoise'],
    };
    let capturedUrl = '';
    let capturedBody: any = null;
    globalThis.fetch = ((url: any, init: any) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(makeJsonResponse(sidecarPayload));
    }) as any;

    const svc = new ImagePreprocessorService();
    const inputPath = path.join(tmpRoot, 'in.png');
    fs.writeFileSync(inputPath, TINY_PNG);

    const result = await svc.preprocess('doc-5', inputPath, 'image/png', {
      force: true,
      targetDpi: 300,
      deskew: true,
    });

    expect(capturedUrl).toBe('http://sidecar:8000/preprocess-image');
    expect(capturedBody.imageBase64).toBe(TINY_PNG.toString('base64'));
    expect(capturedBody.targetDpi).toBe(300);
    expect(capturedBody.deskew).toBe(true);

    expect(result).not.toBeNull();
    expect(result!.deskewAngleDegrees).toBe(1.23);
    expect(result!.wasCroppedToPage).toBe(true);
    expect(result!.stepsApplied).toContain('clahe');

    expect(fs.existsSync(result!.outputPath)).toBe(true);
    expect(fs.statSync(result!.outputPath).size).toBeGreaterThan(0);
  });

  it('returns null on a cached output without re-calling the sidecar (force=false)', async () => {
    process.env.ML_SIDECAR_URL = 'http://sidecar:8000';
    const svc = new ImagePreprocessorService();
    const inputPath = path.join(tmpRoot, 'in.png');
    fs.writeFileSync(inputPath, TINY_PNG);

    // Pre-create a cached output file.
    const cachedPath = svc.outputPath('doc-cached');
    fs.mkdirSync(path.dirname(cachedPath), { recursive: true });
    fs.writeFileSync(cachedPath, TINY_PNG);

    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.resolve(makeJsonResponse({}, true));
    }) as any;

    const result = await svc.preprocess('doc-cached', inputPath, 'image/png');
    expect(result).toBeNull();
    expect(fetchCalled).toBe(false);
  });
});
