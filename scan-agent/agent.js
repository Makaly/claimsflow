'use strict';

const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { writeFile, readFile, unlink } = require('fs/promises');
const { tmpdir, platform, hostname } = require('os');
const { join } = require('path');
const { randomUUID } = require('crypto');
const PDFDocument = require('pdfkit');

const execFileAsync = promisify(execFile);

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.SCAN_AGENT_PORT ? parseInt(process.env.SCAN_AGENT_PORT) : 7420;
const HOST = '127.0.0.1'; // localhost only — never expose to the network
const OS   = platform();  // 'win32' | 'linux' | 'darwin'

const ALLOWED_ORIGINS = [
  'https://claimsflow-frontend.onrender.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:8080',
];

// ── Express setup ───────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '2mb' }));

// Chrome Private Network Access (PNA): public-origin HTTPS pages calling
// localhost must receive Access-Control-Allow-Private-Network: true in the
// preflight, otherwise the fetch is blocked silently. Set it on every response.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (e.g. curl) and all localhost variants
    if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || ALLOWED_ORIGINS.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  // Allow the preflight to advertise PNA support
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition'],
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
const VALID_RESOLUTIONS = new Set([75, 150, 300, 600]);
const VALID_MODES       = new Set(['Color', 'Gray', 'Lineart']);

function sanitiseResolution(v) { return VALID_RESOLUTIONS.has(Number(v)) ? Number(v) : 300; }
function sanitiseMode(v)       { return VALID_MODES.has(v) ? v : 'Color'; }

// Convert raw image buffer → PDF (A4 points)
function imageToPdf(imageBuffer) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.addPage({ size: [595.28, 841.89] });
    doc.image(imageBuffer, 0, 0, { fit: [595.28, 841.89], align: 'center', valign: 'center' });
    doc.end();
  });
}

// ── Linux / macOS — SANE (scanimage) ────────────────────────────────────────
async function listLinuxDevices() {
  try {
    const { stdout } = await execFileAsync('scanimage', ['-L'], { timeout: 15_000 });
    const devices = [];
    for (const line of stdout.split('\n')) {
      const m = line.match(/^device\s+`([^']+)'\s+is a\s+(.+)$/i);
      if (!m) continue;
      const id   = m[1].trim();
      const desc = m[2].trim();
      const words = desc.split(/\s+/);
      const vendor = words[0] ?? 'Unknown';
      const last   = words.at(-1)?.toLowerCase() ?? '';
      const type   = ['scanner','flatbed','adf','device'].includes(last) ? last : 'scanner';
      const model  = words.slice(0, -1).join(' ') || desc;
      devices.push({ id, name: desc, vendor, model, type });
    }
    return { devices, driverAvailable: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { devices: [], driverAvailable: false };
    return { devices: [], driverAvailable: true };
  }
}

async function scanLinux(deviceId, resolution, mode) {
  const uid    = randomUUID();
  const tmpPng = join(tmpdir(), `cfa-scan-${uid}.png`);
  try {
    await execFileAsync(
      'scanimage',
      [`--device-name=${deviceId}`, `--resolution=${resolution}`, `--mode=${mode}`, '--format=png', '-o', tmpPng],
      { timeout: 120_000 },
    );
    return imageToPdf(await readFile(tmpPng));
  } finally {
    await unlink(tmpPng).catch(() => {});
  }
}

// ── Windows — WIA 1.0 (covers TWAIN + ISIS devices with WIA drivers) ─────────
async function listWindowsDevices() {
  const scriptPath = join(tmpdir(), `cfa-wia-list-${randomUUID()}.ps1`);
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $wia = New-Object -ComObject WIA.DeviceManager
  $out = @()
  for ($i = 1; $i -le $wia.DeviceInfos.Count; $i++) {
    $di = $wia.DeviceInfos.Item($i)
    if ($di.Type -eq 1) {
      $n = try { $di.Properties.Item('Name').Value         } catch { 'Unknown Scanner' }
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
    const devices = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [id = '', name = 'Unknown Scanner', vendor = 'Unknown'] = line.trim().split('|');
      return { id, name, vendor, model: name, type: 'scanner' };
    });
    return { devices, driverAvailable: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { devices: [], driverAvailable: false };
    return { devices: [], driverAvailable: true };
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
}

async function scanWindows(deviceId, resolution, mode) {
  const uid        = randomUUID();
  const tmpBmp     = join(tmpdir(), `cfa-scan-${uid}.bmp`);
  const scriptPath = join(tmpdir(), `cfa-wia-scan-${uid}.ps1`);
  // WIA_IPA_DATATYPE: 1=Color, 2=Grayscale, 0=Black&White
  const dataType  = mode === 'Color' ? 1 : mode === 'Gray' ? 2 : 0;
  const safeId    = deviceId.replace(/'/g, "''");
  const safePath  = tmpBmp.replace(/\\/g, '\\\\');

  const script = `
$ErrorActionPreference = 'Stop'
$wia = New-Object -ComObject WIA.DeviceManager
$dev = $null
for ($i = 1; $i -le $wia.DeviceInfos.Count; $i++) {
  $di = $wia.DeviceInfos.Item($i)
  if ($di.DeviceID -eq '${safeId}') {
    $attempts = 0
    while ($attempts -lt 3) {
      try { $dev = $di.Connect(); break } catch {
        $attempts++
        if ($attempts -ge 3) { throw "Scanner is busy (locked by another process). Close any other scanning applications and try again." }
        Start-Sleep -Milliseconds 1500
      }
    }
    break
  }
}
if (-not $dev) { throw 'Device not found' }
$item = $dev.Items.Item(1)
try { $item.Properties.Item(6147).Value = ${resolution} } catch {}
try { $item.Properties.Item(6148).Value = ${resolution} } catch {}
try { $item.Properties.Item(4103).Value = ${dataType}   } catch {}
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
    return imageToPdf(await readFile(tmpBmp));
  } finally {
    await unlink(tmpBmp).catch(() => {});
    await unlink(scriptPath).catch(() => {});
  }
}

// ── Route helpers ───────────────────────────────────────────────────────────
async function listDevices() {
  if (OS === 'win32') return listWindowsDevices();
  return listLinuxDevices();            // Linux & macOS
}

async function scan(deviceId, resolution, mode) {
  if (OS === 'win32') return scanWindows(deviceId, resolution, mode);
  return scanLinux(deviceId, resolution, mode);
}

// ── Routes ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  // hostname + os let the cloud dashboard show which physical machine the
  // scan came from.
  res.json({
    ok: true,
    version: '1.0.0',
    os: OS,
    hostname: hostname(),
    port: PORT,
  });
});

app.get('/scanners', async (_req, res) => {
  try {
    const result = await listDevices();
    res.json({ ...result, platform: OS === 'win32' ? 'windows' : OS === 'darwin' ? 'macos' : 'linux' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/scan', async (req, res) => {
  const { deviceId, resolution: rawRes, mode: rawMode } = req.body ?? {};
  if (!deviceId?.trim()) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const resolution = sanitiseResolution(rawRes);
  const mode       = sanitiseMode(rawMode);

  // Validate device is in the discovered list (prevents injection)
  const { devices } = await listDevices();
  if (!devices.some(d => d.id === deviceId)) {
    return res.status(400).json({ error: 'Unknown scanner device' });
  }

  try {
    const pdf = await scan(deviceId, resolution, mode);
    const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="scan-${ts}.pdf"`,
      'Content-Length':      pdf.length,
    });
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: `Scan failed: ${err.message}` });
  }
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          ClaimsFlow Local Scan Agent v1.0.0          ║
╠══════════════════════════════════════════════════════╣
║  Listening on  http://127.0.0.1:${PORT}                ║
║  Platform      ${OS.padEnd(38)}║
║                                                      ║
║  Open ClaimsFlow in your browser, go to              ║
║  Batch Upload → Scan Document.                       ║
║  Your TWAIN / SANE / ISIS scanners will appear.      ║
║                                                      ║
║  Press Ctrl+C to stop.                               ║
╚══════════════════════════════════════════════════════╝
`);
});
