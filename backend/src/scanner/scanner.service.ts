import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';

const execFileAsync = promisify(execFile);

export interface ScannerDevice {
  id: string;
  name: string;
  vendor: string;
  model: string;
  type: string;
}

@Injectable()
export class ScannerService {
  async listDevices(): Promise<{ devices: ScannerDevice[]; saneAvailable: boolean }> {
    try {
      const { stdout } = await execFileAsync('scanimage', ['-L'], { timeout: 15_000 });
      return { devices: this.parseDevices(stdout), saneAvailable: true };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { devices: [], saneAvailable: false };
      }
      // SANE installed but no scanners attached → non-zero exit, empty stdout
      return { devices: [], saneAvailable: true };
    }
  }

  private parseDevices(output: string): ScannerDevice[] {
    const devices: ScannerDevice[] = [];
    for (const line of output.split('\n')) {
      // device `epson2:libusb:001:006' is a Epson WorkForce DS-530 flatbed scanner
      const m = line.match(/^device\s+`([^']+)'\s+is a\s+(.+)$/i);
      if (!m) continue;
      const id = m[1].trim();
      const desc = m[2].trim();
      const words = desc.split(/\s+/);
      const vendor = words[0] ?? 'Unknown';
      const lastWord = words[words.length - 1]?.toLowerCase() ?? '';
      const type = ['scanner', 'flatbed', 'adf', 'device'].includes(lastWord) ? lastWord : 'scanner';
      const model = words.slice(0, -1).join(' ') || desc;
      devices.push({ id, name: desc, vendor, model, type });
    }
    return devices;
  }

  async scan(deviceId: string, resolution: number, mode: string): Promise<Buffer> {
    const uid = randomUUID();
    const tmpPng = join(tmpdir(), `cic-scan-${uid}.png`);

    try {
      await execFileAsync(
        'scanimage',
        [
          `--device-name=${deviceId}`,
          `--resolution=${resolution}`,
          `--mode=${mode}`,
          '--format=png',
          `-o`, tmpPng,
        ],
        { timeout: 120_000 },
      );

      const imgBuf = await readFile(tmpPng);
      return this.imageToPdf(imgBuf);
    } catch (err: any) {
      throw new InternalServerErrorException(`Scan failed: ${err.message}`);
    } finally {
      await unlink(tmpPng).catch(() => {});
    }
  }

  private imageToPdf(imageBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      // A4 dimensions in points
      doc.addPage({ size: [595.28, 841.89] });
      doc.image(imageBuffer, 0, 0, { fit: [595.28, 841.89], align: 'center', valign: 'center' });
      doc.end();
    });
  }
}
