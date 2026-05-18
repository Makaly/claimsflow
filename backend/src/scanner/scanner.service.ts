import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink, writeFile } from 'fs/promises';
import { tmpdir, platform } from 'os';
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

export interface DeviceListResult {
  devices: ScannerDevice[];
  driverAvailable: boolean;
  platform: 'linux' | 'windows' | 'other';
}

@Injectable()
export class ScannerService {
  private readonly osPlatform = platform();

  async listDevices(): Promise<DeviceListResult> {
    if (this.osPlatform === 'win32') return this.listWindowsDevices();
    return this.listLinuxDevices();
  }

  private async listLinuxDevices(): Promise<DeviceListResult> {
    try {
      const { stdout } = await execFileAsync('scanimage', ['-L'], { timeout: 15_000 });
      return { devices: this.parseLinuxDevices(stdout), driverAvailable: true, platform: 'linux' };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { devices: [], driverAvailable: false, platform: 'linux' };
      }
      // SANE installed but no scanner attached — non-zero exit, empty stdout
      return { devices: [], driverAvailable: true, platform: 'linux' };
    }
  }

  private async listWindowsDevices(): Promise<DeviceListResult> {
    const scriptPath = join(tmpdir(), `cic-wia-list-${randomUUID()}.ps1`);
    const script = `
$ErrorActionPreference = 'Stop'
try {
  $wia = New-Object -ComObject WIA.DeviceManager
  $out = @()
  for ($i = 1; $i -le $wia.DeviceInfos.Count; $i++) {
    $di = $wia.DeviceInfos.Item($i)
    if ($di.Type -eq 1) {
      $n = try { $di.Properties.Item('Name').Value } catch { 'Unknown Scanner' }
      $v = try { $di.Properties.Item('Manufacturer').Value } catch { 'Unknown' }
      $out += "$($di.DeviceID)|$n|$v"
    }
  }
  if ($out.Count -gt 0) { $out -join [Environment]::NewLine }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`;
    try {
      await writeFile(scriptPath, script, 'utf8');
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { timeout: 15_000 },
      );
      return { devices: this.parseWindowsDevices(stdout), driverAvailable: true, platform: 'windows' };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { devices: [], driverAvailable: false, platform: 'windows' };
      }
      return { devices: [], driverAvailable: true, platform: 'windows' };
    } finally {
      await unlink(scriptPath).catch(() => {});
    }
  }

  private parseLinuxDevices(output: string): ScannerDevice[] {
    const devices: ScannerDevice[] = [];
    for (const line of output.split('\n')) {
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

  private parseWindowsDevices(output: string): ScannerDevice[] {
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id = '', name = 'Unknown Scanner', vendor = 'Unknown'] = line.trim().split('|');
        return { id, name, vendor, model: name, type: 'scanner' };
      });
  }

  async scan(deviceId: string, resolution: number, mode: string): Promise<Buffer> {
    if (this.osPlatform === 'win32') return this.scanWindows(deviceId, resolution, mode);
    return this.scanLinux(deviceId, resolution, mode);
  }

  private async scanLinux(deviceId: string, resolution: number, mode: string): Promise<Buffer> {
    const uid = randomUUID();
    const tmpPng = join(tmpdir(), `cic-scan-${uid}.png`);
    try {
      await execFileAsync(
        'scanimage',
        [`--device-name=${deviceId}`, `--resolution=${resolution}`, `--mode=${mode}`, '--format=png', '-o', tmpPng],
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

  private async scanWindows(deviceId: string, resolution: number, mode: string): Promise<Buffer> {
    const uid = randomUUID();
    const tmpBmp = join(tmpdir(), `cic-scan-${uid}.bmp`);
    const scriptPath = join(tmpdir(), `cic-wia-scan-${uid}.ps1`);
    // WIA_IPA_DATATYPE values: 1=Color, 2=Grayscale, 0=Black&White
    const dataType = mode === 'Color' ? 1 : mode === 'Gray' ? 2 : 0;
    // PS single-quote escape for the device ID (GUID path, safe characters only)
    const safeId = deviceId.replace(/'/g, "''");
    const safePath = tmpBmp.replace(/\\/g, '\\\\');

    const script = `
$ErrorActionPreference = 'Stop'
$wia = New-Object -ComObject WIA.DeviceManager
$dev = $null
for ($i = 1; $i -le $wia.DeviceInfos.Count; $i++) {
  $di = $wia.DeviceInfos.Item($i)
  if ($di.DeviceID -eq '${safeId}') { $dev = $di.Connect(); break }
}
if (-not $dev) { throw 'Device not found' }
$item = $dev.Items.Item(1)
try { $item.Properties.Item(6147).Value = ${resolution} } catch {}
try { $item.Properties.Item(6148).Value = ${resolution} } catch {}
try { $item.Properties.Item(4103).Value = ${dataType} } catch {}
$img = $item.Transfer('{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}')
$img.SaveFile('${safePath}')
`;
    try {
      await writeFile(scriptPath, script, 'utf8');
      await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { timeout: 120_000 },
      );
      const imgBuf = await readFile(tmpBmp);
      return this.imageToPdf(imgBuf);
    } catch (err: any) {
      throw new InternalServerErrorException(`Scan failed: ${err.message}`);
    } finally {
      await unlink(tmpBmp).catch(() => {});
      await unlink(scriptPath).catch(() => {});
    }
  }

  private imageToPdf(imageBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.addPage({ size: [595.28, 841.89] });
      doc.image(imageBuffer, 0, 0, { fit: [595.28, 841.89], align: 'center', valign: 'center' });
      doc.end();
    });
  }
}
