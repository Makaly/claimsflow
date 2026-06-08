import * as fs from 'fs';
import { BadRequestException } from '@nestjs/common';

/**
 * Content-based (magic-byte) validation for uploaded documents.
 *
 * The previous filter trusted only the client-supplied filename extension,
 * which is trivially spoofable (e.g. `shell.php` renamed to `invoice.pdf`).
 * Here we read the real file header and confirm it matches one of the allowed
 * types. Anything else is rejected and the file deleted from disk.
 *
 * Allowed: PDF, JPEG, PNG, TIFF (LE/BE).
 */
type Sig = { name: string; bytes: number[] };

const SIGNATURES: Sig[] = [
  { name: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { name: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { name: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: 'tiff-le', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { name: 'tiff-be', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
];

function headerMatches(header: Buffer, sig: number[]): boolean {
  if (header.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (header[i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Verify the file at `filePath` has an allowed magic-byte signature. On failure
 * the file is deleted and a 400 is thrown. Safe to call right after multer
 * writes an upload to disk.
 */
export function assertAllowedFileSignature(filePath: string): void {
  let fd: number | undefined;
  let header: Buffer;
  try {
    fd = fs.openSync(filePath, 'r');
    header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  const ok = SIGNATURES.some((s) => headerMatches(header, s.bytes));
  if (!ok) {
    // Remove the rejected file so unvalidated content never lingers on disk.
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* best-effort cleanup */
    }
    throw new BadRequestException(
      'File content is not a valid PDF, image, or TIFF.',
    );
  }
}
