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

// ── Vendor SDK drivers ───────────────────────────────────────────────────────
// naps2  → TWAIN driver; covers Canon, Kodak/Alaris, Fujitsu, Xerox, Ricoh …
// escl   → eSCL/AirScan HTTP protocol; covers network scanners from all vendors
const naps2Driver = (() => { try { return require('./drivers/naps2'); } catch { return null; } })();
const esclDriver  = (() => { try { return require('./drivers/escl');  } catch { return null; } })();

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

// Allowed-origin check shared by both the preflight handler and cors()
function isAllowedOrigin(origin) {
  return !origin
    || origin.startsWith('http://localhost')
    || origin.startsWith('http://127.0.0.1')
    || origin.startsWith('https://localhost')
    || ALLOWED_ORIGINS.includes(origin);
}

// Chrome Private Network Access (PNA): a public-origin HTTPS page (e.g. the
// Render deployment) calling localhost must receive Access-Control-Allow-Private-Network
// in the preflight OPTIONS response, or Chrome blocks the request silently.
// We handle OPTIONS explicitly before cors() so the header is guaranteed.
app.options('*', (req, res) => {
  const origin = req.headers.origin ?? '';
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

app.use(cors({
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition'],
}));

// Ensure PNA header is present on every non-OPTIONS response too
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

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

// ── Driver registry ──────────────────────────────────────────────────────────
// All discovered devices are pooled from every available driver.
// deviceId prefixes determine which driver handles each scan:
//   'naps2:twain:…'  → NAPS2 TWAIN (Canon, Kodak, Fujitsu, Xerox, …)
//   'naps2:wia:…'    → NAPS2 WIA
//   'escl:http://…'  → eSCL network scanner
//   anything else    → native WIA (Windows) or SANE (Linux/macOS)

// Cache the device list so /scan validation doesn't re-run a slow mDNS
// discovery. TTL is long because network scanner indices (airscan wN) can
// change between scanimage -L runs, causing false "Unknown device" errors.
let _deviceCache = null;
let _deviceCacheAt = 0;
const DEVICE_CACHE_TTL_MS = 5 * 60_000; // 5 min

async function listDevices() {
  if (_deviceCache && Date.now() - _deviceCacheAt < DEVICE_CACHE_TTL_MS) {
    return _deviceCache;
  }
  const allDevices = [];
  let driverAvailable = false;

  // 1. Native driver (WIA / SANE) — always attempted
  const native = OS === 'win32' ? await listWindowsDevices() : await listLinuxDevices();
  if (native.driverAvailable) driverAvailable = true;
  allDevices.push(...(native.devices || []).map(d => ({ ...d, driver: OS === 'win32' ? 'wia' : 'sane' })));

  // 2. NAPS2 (TWAIN / Canon / Kodak / Fujitsu) — when installed
  if (naps2Driver) {
    try {
      const naps2Devices = await naps2Driver.listAllNaps2Devices();
      if (naps2Devices.length) driverAvailable = true;
      // Deduplicate by name — some scanners appear in both WIA and TWAIN lists
      for (const d of naps2Devices) {
        if (!allDevices.find(x => x.name === d.name)) allDevices.push(d);
      }
    } catch { /* NAPS2 not installed */ }
  }

  // 3. eSCL network scanners (Canon, Kodak, Epson, HP, Brother, Xerox, …)
  if (esclDriver) {
    try {
      const esclDevices = await esclDriver.listEsclDevices();
      if (esclDevices.length) driverAvailable = true;
      allDevices.push(...esclDevices);
    } catch { /* eSCL discovery failed */ }
  }

  const result = { devices: allDevices, driverAvailable };
  _deviceCache = result;
  _deviceCacheAt = Date.now();
  return result;
}

async function scan(deviceId, resolution, mode) {
  // Route by deviceId prefix
  if (deviceId.startsWith('naps2:') && naps2Driver) {
    return naps2Driver.scanNaps2(deviceId, resolution, mode);
  }
  if (deviceId.startsWith('escl:') && esclDriver) {
    return esclDriver.scanEscl(deviceId, resolution, mode);
  }
  // Native fallback
  if (OS === 'win32') return scanWindows(deviceId, resolution, mode);
  return scanLinux(deviceId, resolution, mode);
}

// ── Routes ──────────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const naps2Available = naps2Driver ? await naps2Driver.isNaps2Available().catch(() => false) : false;
  res.json({
    ok: true,
    version: '1.1.0',
    os: OS,
    hostname: hostname(),
    port: PORT,
    drivers: {
      wia:   OS === 'win32',
      sane:  OS !== 'win32',
      naps2: naps2Available,   // TWAIN — Canon, Kodak, Fujitsu, Xerox, etc.
      escl:  !!esclDriver,     // network eSCL/AirScan scanners
    },
  });
});

// Returns driver availability and vendor-specific install recommendations.
// Useful for IT admins setting up Canon, Kodak, or Fujitsu scanners.
app.get('/diagnostics', async (_req, res) => {
  const result = { os: OS, drivers: {} };

  if (OS === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command',
          'Get-WmiObject Win32_PnPEntity | Where-Object {$_.Name -like "*Scanner*" -or $_.Name -like "*Scan*"} | Select-Object Name,Manufacturer | ConvertTo-Json'],
        { timeout: 10_000 },
      );
      result.drivers.wia_devices = JSON.parse(stdout || '[]');
    } catch { result.drivers.wia_devices = []; }
  }

  if (naps2Driver) {
    result.drivers.naps2 = await naps2Driver.diagnoseWindows().catch(err => ({ error: err.message }));
  } else {
    result.drivers.naps2 = { naps2Installed: false, recommendations: ['Install NAPS2: winget install cyanfish.naps2'] };
  }

  if (esclDriver) {
    const esclDevices = await esclDriver.listEsclDevices().catch(() => []);
    result.drivers.escl = { devices: esclDevices, note: 'Set ESCL_SCANNERS env var to comma-separated scanner URLs for static config' };
  }

  res.json(result);
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

  // Validate device is in the discovered list (prevents injection).
  // execFileAsync passes deviceId as an array arg so shell injection is
  // already impossible; this check just gates unknown devices.
  const { devices } = await listDevices();
  const exactMatch = devices.some(d => d.id === deviceId);
  // airscan:wN: indices are non-deterministic between scanimage -L runs.
  // Accept any airscan device whose scanner-name suffix matches.
  const airscanSuffix = deviceId.startsWith('airscan:')
    ? deviceId.replace(/^airscan:w\d+:/, '')
    : null;
  const nameMatch = airscanSuffix
    && devices.some(d => d.id.startsWith('airscan:') && d.id.replace(/^airscan:w\d+:/, '') === airscanSuffix);
  if (!exactMatch && !nameMatch) {
    return res.status(400).json({ error: 'Unknown scanner device' });
  }
  // If the index changed, normalise deviceId to what the live list has
  const resolvedId = (nameMatch && !exactMatch)
    ? devices.find(d => d.id.startsWith('airscan:') && d.id.replace(/^airscan:w\d+:/, '') === airscanSuffix).id
    : deviceId;

  try {
    const pdf = await scan(resolvedId, resolution, mode);
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
app.listen(PORT, HOST, async () => {
  const naps2Ok = naps2Driver ? await naps2Driver.isNaps2Available().catch(() => false) : false;
  const nativeDriver = OS === 'win32' ? 'WIA' : OS === 'darwin' ? 'SANE' : 'SANE';

  console.log(`
╔══════════════════════════════════════════════════════════╗
║          ClaimsFlow Local Scan Agent v1.1.0              ║
╠══════════════════════════════════════════════════════════╣
║  Listening on  http://127.0.0.1:${PORT}                    ║
║  Platform      ${OS.padEnd(42)}║
╠══════════════════════════════════════════════════════════╣
║  Active drivers:                                         ║
║    ${(nativeDriver + ' (built-in)').padEnd(54)}║
║    NAPS2/TWAIN/ISIS  ${naps2Ok ? '✓ ready (Canon, Kodak, Fujitsu…)' : '✗ not installed — run: winget install cyanfish.naps2'}${''.padEnd(Math.max(0, 3 - (naps2Ok ? 0 : 0)))}║
║    eSCL/AirScan      ${esclDriver ? '✓ ready (Canon, Kodak, Epson, HP…)' : '✗ unavailable'}${''.padEnd(19)}║
╠══════════════════════════════════════════════════════════╣
║  Open ClaimsFlow → Batch Upload → Scan Document          ║
║  Run GET /diagnostics for vendor-specific setup help     ║
║  Press Ctrl+C to stop                                    ║
╚══════════════════════════════════════════════════════════╝
`);
});
