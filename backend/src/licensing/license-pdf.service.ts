import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import * as QRCode from 'qrcode';
import { LicenseInfo } from './license.service';
import { UNLIMITED } from './plans';
// pdfkit is CommonJS — import-equals keeps it runtime-safe under module:commonjs.
import PDFDocument = require('pdfkit');

const INK = {
  bg: '#0f0f11',
  band1: '#10b981',
  band2: '#06b6d4',
  band3: '#6366f1',
  ink: '#111827',
  sub: '#6b7280',
  line: '#e5e7eb',
  card: '#f9fafb',
  green: '#059669',
  red: '#dc2626',
  amber: '#d97706',
};

/**
 * Branded ClaimsFlow licence certificate (PDFKit + QR). Single A4 page:
 * letterhead, licensed-to / licence-details cards, a QR verification block, and
 * a SHA-256 verification strip. The QR/hash are presentational integrity marks
 * (distinct from the Ed25519 token signing) — they let anyone confirm the cert
 * matches the issued key offline.
 */
@Injectable()
export class LicensePdfService {
  private readonly logger = new Logger(LicensePdfService.name);

  private fmtDate(d: Date | null): string {
    if (!d) return 'Perpetual';
    return d.toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  private cap(n: number): string {
    return n >= UNLIMITED ? 'Unlimited' : n.toLocaleString('en-KE');
  }

  /** Serial = first 12 hex of sha256(licenceKey). */
  private serial(key: string | null): string {
    return createHash('sha256').update(key ?? 'UNKEYED').digest('hex').slice(0, 12).toUpperCase();
  }

  /** Presentational verification hash (key + expiry, salted). */
  private vHash(info: LicenseInfo): string {
    const basis = `${info.licenseKey}-${info.licenseExpiryDate?.toISOString() ?? 'PERPETUAL'}-CLAIMSFLOW-SECURE`;
    return createHash('sha256').update(basis).digest('hex').slice(0, 24).toUpperCase();
  }

  async generate(info: LicenseInfo): Promise<Buffer> {
    const serial = this.serial(info.licenseKey);
    const vhash = this.vHash(info);

    // QR encodes a compact verification record.
    const qrPayload = JSON.stringify({
      key: info.licenseKey,
      serial,
      tenant: info.tenantName,
      plan: info.plan,
      type: info.licenseType,
      expiry: info.licenseExpiryDate?.toISOString() ?? null,
      vhash,
    });
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 240 });
    const qrBuf = Buffer.from(qrDataUrl.split(',')[1], 'base64');

    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const W = doc.page.width; // 595.28
    const M = 54;

    // ── Top rainbow band ──
    const bandW = (W - 0) / 3;
    doc.rect(0, 0, bandW, 6).fill(INK.band1);
    doc.rect(bandW, 0, bandW, 6).fill(INK.band2);
    doc.rect(bandW * 2, 0, bandW, 6).fill(INK.band3);

    // ── Letterhead ──
    doc.fill(INK.sub).fontSize(9).font('Helvetica-Bold').text('CIC INSURANCE GROUP PLC', M, 38, { characterSpacing: 2 });
    doc.fill(INK.ink).fontSize(26).font('Helvetica-Bold').text('ClaimsFlow', M, 54);
    doc.fill(INK.sub).fontSize(11).font('Helvetica').text('Software Licence Certificate', M, 86);
    doc.fill(INK.sub).fontSize(8).text('P.O. Box 59485-00200, Nairobi  ·  claims@cic.co.ke', M, 104);

    // Status chip (top-right)
    const statusColor = info.isReadOnly ? INK.red : info.isPaused ? INK.amber : INK.green;
    doc.roundedRect(W - M - 130, 50, 130, 26, 6).fill(statusColor);
    doc.fill('#ffffff').fontSize(11).font('Helvetica-Bold')
      .text(info.licenseStatus, W - M - 130, 57, { width: 130, align: 'center' });

    let y = 140;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(1).stroke(INK.line);
    y += 24;

    // ── Two cards: Licensed To / Licence Details ──
    const cardW = (W - M * 2 - 16) / 2;
    const cardH = 150;
    const drawCard = (x: number, title: string, rows: [string, string][]) => {
      doc.roundedRect(x, y, cardW, cardH, 8).fill(INK.card);
      doc.roundedRect(x, y, cardW, 4, 2).fill(INK.band1);
      doc.fill(INK.sub).fontSize(8).font('Helvetica-Bold').text(title.toUpperCase(), x + 16, y + 16, { characterSpacing: 1.2 });
      let ry = y + 36;
      for (const [k, v] of rows) {
        doc.fill(INK.sub).fontSize(8).font('Helvetica').text(k, x + 16, ry);
        doc.fill(INK.ink).fontSize(11).font('Helvetica-Bold').text(v, x + 16, ry + 10, { width: cardW - 32 });
        ry += 36;
      }
    };

    drawCard(M, 'Licensed To', [
      ['Organisation', info.tenantName],
      ['Plan', `${info.plan.toUpperCase()} (${info.licenseType})`],
      ['Serial', serial],
    ]);
    drawCard(M + cardW + 16, 'Licence Details', [
      ['Issued', this.fmtDate(info.licenseStartDate)],
      ['Expires', this.fmtDate(info.licenseExpiryDate)],
      ['Days Remaining', info.daysRemaining === null ? '∞' : String(info.daysRemaining)],
    ]);
    y += cardH + 22;

    // ── Entitlement caps strip ──
    doc.fill(INK.sub).fontSize(8).font('Helvetica-Bold').text('ENTITLEMENT LIMITS', M, y, { characterSpacing: 1.2 });
    y += 16;
    const caps: [string, string][] = [
      ['Seats', this.cap(info.maxSeats)],
      ['Claims / month', this.cap(info.maxClaimsPerMonth)],
      ['Extractions / month', this.cap(info.maxExtractionsPerMonth)],
    ];
    const capW = (W - M * 2 - 16) / 3;
    caps.forEach(([k, v], i) => {
      const x = M + i * (capW + 8);
      doc.roundedRect(x, y, capW, 56, 8).fill(INK.card);
      doc.fill(INK.ink).fontSize(16).font('Helvetica-Bold').text(v, x, y + 12, { width: capW, align: 'center' });
      doc.fill(INK.sub).fontSize(8).font('Helvetica').text(k, x, y + 36, { width: capW, align: 'center' });
    });
    y += 78;

    // ── Licence key (monospace-ish) ──
    doc.roundedRect(M, y, W - M * 2, 40, 8).fill('#111827');
    doc.fill('#9ca3af').fontSize(7).font('Helvetica-Bold').text('LICENCE KEY', M + 16, y + 8, { characterSpacing: 1.2 });
    doc.fill('#ffffff').fontSize(13).font('Courier-Bold').text(info.licenseKey ?? '—', M + 16, y + 18);
    y += 60;

    // ── QR + verification strip ──
    doc.image(qrBuf, M, y, { width: 96, height: 96 });
    const vx = M + 120;
    doc.fill(INK.sub).fontSize(8).font('Helvetica-Bold').text('VERIFY THIS CERTIFICATE', vx, y + 4, { characterSpacing: 1.2 });
    doc.fill(INK.ink).fontSize(9).font('Helvetica').text(
      'Scan the QR code or quote the verification hash and serial below to confirm this certificate against the issued licence record.',
      vx, y + 18, { width: W - M - vx },
    );
    doc.fill(INK.sub).fontSize(8).font('Helvetica').text('Verification hash', vx, y + 56);
    doc.fill(INK.green).fontSize(11).font('Courier-Bold').text(vhash, vx, y + 67);
    y += 116;

    // ── Footer ──
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(1).stroke(INK.line);
    doc.fill(INK.sub).fontSize(8).font('Helvetica').text(
      `Issued by CIC Insurance Group PLC · ClaimsFlow Licensing · © ${new Date().getFullYear()}. This certificate is system-generated and valid without signature.`,
      M, y + 10, { width: W - M * 2, align: 'center' },
    );

    doc.end();
    return done;
  }
}
