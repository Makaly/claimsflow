'use strict';

const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { writeFile, readFile, unlink } = require('fs/promises');
const { tmpdir, platform, hostname } = require('os');
const { join } = require('path');
const { randomUUID } = require('crypto');
const zlib = require('zlib');
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

// On Linux/macOS, point scanimage at our minimal SANE config so only the
// airscan backend loads. The system dll.conf enables 40+ backends that probe
// USB/SNMP on every scanimage -L call and inflate listing time to ~9 seconds.
const SANE_CONFIG_DIR = join(__dirname, 'sane.d');
const SANE_ENV = OS !== 'win32' ? { ...process.env, SANE_CONFIG_DIR } : process.env;

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
const VALID_RESOLUTIONS = new Set([75, 150, 200, 300, 600, 1200]);
const VALID_MODES       = new Set(['Color', 'Gray', 'Lineart']);
const VALID_SOURCES     = new Set(['auto', 'flatbed', 'feeder', 'feeder-duplex']);
const VALID_PAPER_SIZES = new Set(['auto', 'a4', 'a5', 'letter', 'legal']);

function sanitiseResolution(v) { return VALID_RESOLUTIONS.has(Number(v)) ? Number(v) : 300; }
function sanitiseMode(v)       { return VALID_MODES.has(v) ? v : 'Color'; }
function sanitiseSource(v)     { return VALID_SOURCES.has(v) ? v : 'auto'; }
function sanitisePaperSize(v)  { return VALID_PAPER_SIZES.has(v) ? v : 'auto'; }

// Paper dimensions in PDF points (72 pt/in)
const PAPER_DIMS = {
  a4:     [595.28, 841.89],
  a5:     [419.53, 595.28],
  letter: [612, 792],
  legal:  [612, 1008],
  auto:   [595.28, 841.89],  // fallback to A4
};

// Convert raw image buffer → PDF, fitting to requested paper size
function imageToPdf(imageBuffer, paperSize = 'auto') {
  return new Promise((resolve, reject) => {
    const [w, h] = PAPER_DIMS[paperSize] ?? PAPER_DIMS.auto;
    const chunks = [];
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.addPage({ size: [w, h] });
    doc.image(imageBuffer, 0, 0, { fit: [w, h], align: 'center', valign: 'center' });
    doc.end();
  });
}

// Combine multiple image buffers into a single multi-page PDF
function imagesToPdf(imageBuffers, paperSize = 'auto') {
  return new Promise((resolve, reject) => {
    const [w, h] = PAPER_DIMS[paperSize] ?? PAPER_DIMS.auto;
    const chunks = [];
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const buf of imageBuffers) {
      doc.addPage({ size: [w, h] });
      doc.image(buf, 0, 0, { fit: [w, h], align: 'center', valign: 'center' });
    }
    doc.end();
  });
}

// Heuristic blank-page detector for PNG buffers.
// Checks whether the IDAT-compressed payload is suspiciously small relative to
// image dimensions, which is a strong signal for an all-white page.
function isPngBlank(pngBuf, threshold = 0.004) {
  try {
    if (pngBuf.length < 33) return false;
    const sig = pngBuf.slice(0, 8).toString('hex');
    if (sig !== '89504e470d0a1a0a') return false;
    const width  = pngBuf.readUInt32BE(16);
    const height = pngBuf.readUInt32BE(20);
    // Collect all IDAT bytes
    let idatBytes = 0;
    let pos = 8;
    while (pos + 12 <= pngBuf.length) {
      const len  = pngBuf.readUInt32BE(pos);
      const type = pngBuf.slice(pos + 4, pos + 8).toString('ascii');
      if (type === 'IDAT') idatBytes += len;
      if (type === 'IEND') break;
      pos += 12 + len;
    }
    // bytes-per-pixel of compressed data; blank pages compress to near 0
    return width > 0 && height > 0 && (idatBytes / (width * height)) < threshold;
  } catch { return false; }
}

// ── Linux / macOS — SANE (scanimage) ────────────────────────────────────────
async function listLinuxDevices() {
  try {
    const { stdout } = await execFileAsync('scanimage', ['-L'], { timeout: 15_000, env: SANE_ENV });
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

// Map our source tokens → SANE --source option strings (tried in order until one works)
const SANE_SOURCES = {
  flatbed:        ['Flatbed'],
  feeder:         ['ADF Front', 'ADF', 'Automatic Document Feeder'],
  'feeder-duplex':['ADF Duplex', 'ADF Both', 'Both'],
  auto:           [],  // let SANE use device default
};

async function scanLinux(deviceId, resolution, mode, { source = 'auto', skipBlank = false, paperSize = 'auto' } = {}) {
  const uid    = randomUUID();
  const tmpPng = join(tmpdir(), `cfa-scan-${uid}.png`);
  const args = [
    `--device-name=${deviceId}`,
    `--resolution=${resolution}`,
    `--mode=${mode}`,
    '--format=png',
    '-o', tmpPng,
  ];
  // For ADF duplex, request multi-page batch output
  const isDuplex = source === 'feeder-duplex';
  const isFeeder = source === 'feeder' || isDuplex;

  const sourceCandidates = SANE_SOURCES[source] ?? [];
  if (sourceCandidates.length > 0) args.push(`--source=${sourceCandidates[0]}`);

  // ADF batch mode: scanimage -b collects all pages into tmp dir
  if (isFeeder) {
    const batchDir  = join(tmpdir(), `cfa-batch-${uid}`);
    await require('fs/promises').mkdir(batchDir, { recursive: true });
    const batchArgs = [
      `--device-name=${deviceId}`,
      `--resolution=${resolution}`,
      `--mode=${mode}`,
      '--format=png',
      '--batch=' + join(batchDir, 'page%03d.png'),
      '--batch-count=50',
    ];
    if (sourceCandidates.length > 0) batchArgs.push(`--source=${sourceCandidates[0]}`);
    try {
      await execFileAsync('scanimage', batchArgs, { timeout: 300_000, env: SANE_ENV });
      const files = (await require('fs/promises').readdir(batchDir))
        .filter(f => f.endsWith('.png'))
        .sort();
      const images = [];
      for (const f of files) {
        const buf = await readFile(join(batchDir, f));
        if (skipBlank && isPngBlank(buf)) continue;
        images.push(buf);
      }
      if (images.length === 0) throw new Error('All pages were blank — place document in the feeder and try again.');
      return images.length === 1 ? imageToPdf(images[0], paperSize) : imagesToPdf(images, paperSize);
    } finally {
      require('fs/promises').rm(batchDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  try {
    await execFileAsync('scanimage', args, { timeout: 120_000, env: SANE_ENV });
    const buf = await readFile(tmpPng);
    if (skipBlank && isPngBlank(buf)) throw new Error('Page appears blank — check that a document is loaded on the glass.');
    return imageToPdf(buf, paperSize);
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

async function scanWindows(deviceId, resolution, mode, { source = 'auto', skipBlank = false, paperSize = 'auto' } = {}) {
  const uid        = randomUUID();
  const tmpBmp     = join(tmpdir(), `cfa-scan-${uid}.bmp`);
  const scriptPath = join(tmpdir(), `cfa-wia-scan-${uid}.ps1`);
  // WIA_IPA_DATATYPE: 1=Color, 2=Grayscale, 0=Black&White
  const dataType  = mode === 'Color' ? 1 : mode === 'Gray' ? 2 : 0;
  const safeId    = deviceId.replace(/'/g, "''");
  const safePath  = tmpBmp.replace(/\\/g, '\\\\');
  // WIA_IPS_DOCUMENT_HANDLING_SELECT: 1=FEEDER, 2=FLATBED
  const wiaSource = source === 'flatbed' ? 2 : (source === 'feeder' || source === 'feeder-duplex') ? 1 : 0;

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
${wiaSource > 0 ? `try { $dev.Properties.Item(3088).Value = ${wiaSource} } catch {}` : ''}
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
    return imageToPdf(await readFile(tmpBmp), paperSize);
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

async function scan(deviceId, resolution, mode, opts = {}) {
  // Route by deviceId prefix
  if (deviceId.startsWith('naps2:') && naps2Driver) {
    return naps2Driver.scanNaps2(deviceId, resolution, mode, opts);
  }
  if (deviceId.startsWith('escl:') && esclDriver) {
    return esclDriver.scanEscl(deviceId, resolution, mode, opts);
  }
  // Native fallback
  if (OS === 'win32') return scanWindows(deviceId, resolution, mode, opts);
  return scanLinux(deviceId, resolution, mode, opts);
}

// ── Scanner capability query ─────────────────────────────────────────────────
async function getScannerCapabilities(deviceId) {
  // eSCL: parse ScannerCapabilities XML for available sources
  if (deviceId.startsWith('escl:') && esclDriver) {
    return esclDriver.getEsclCapabilities(deviceId).catch(() => null);
  }
  // SANE: parse `scanimage --help` for --source options
  if (OS !== 'win32') {
    try {
      const { stdout, stderr } = await execFileAsync(
        'scanimage',
        [`--device-name=${deviceId}`, '--help'],
        { timeout: 15_000, env: SANE_ENV },
      ).catch(e => ({ stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
      const text = stdout + stderr;
      const m = text.match(/--source\s+([^\n]+(?:\n\s+[^\n]+)*)/i);
      const sources = [];
      if (m) {
        const raw = m[1].replace(/\s+/g, ' ');
        if (/flatbed/i.test(raw))            sources.push('flatbed');
        if (/ADF|feeder|automatic/i.test(raw)) sources.push('feeder');
        if (/duplex|both/i.test(raw))         sources.push('feeder-duplex');
      }
      if (sources.length === 0) sources.push('flatbed');
      return { sources, duplex: sources.includes('feeder-duplex') };
    } catch { /* fall through */ }
  }
  // Default: assume flatbed + feeder for all other scanners
  return { sources: ['flatbed', 'feeder', 'feeder-duplex'], duplex: true };
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

app.get('/scanner/capabilities', async (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId?.trim()) return res.status(400).json({ error: 'deviceId is required' });
  const { devices } = await listDevices();
  if (!devices.some(d => d.id === deviceId || (deviceId.startsWith('airscan:') && d.id.replace(/^airscan:w\d+:/, '') === deviceId.replace(/^airscan:w\d+:/, '')))) {
    return res.status(400).json({ error: 'Unknown scanner device' });
  }
  try {
    const caps = await getScannerCapabilities(deviceId);
    res.json(caps ?? { sources: ['flatbed', 'feeder', 'feeder-duplex'], duplex: true });
  } catch (err) {
    res.json({ sources: ['flatbed', 'feeder', 'feeder-duplex'], duplex: true });
  }
});

app.post('/scan', async (req, res) => {
  // Accept params from query string (no-body POST = no CORS preflight) or JSON body.
  const params = { ...req.query, ...(req.body ?? {}) };
  const { deviceId, resolution: rawRes, mode: rawMode, source: rawSource, paperSize: rawPaperSize } = params;
  const skipBlank = params.skipBlank === 'true' || params.skipBlank === true;

  if (!deviceId?.trim()) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const resolution = sanitiseResolution(rawRes);
  const mode       = sanitiseMode(rawMode);
  const source     = sanitiseSource(rawSource);
  const paperSize  = sanitisePaperSize(rawPaperSize);

  // Validate device is in the discovered list (prevents injection).
  const { devices } = await listDevices();
  const exactMatch = devices.some(d => d.id === deviceId);
  const airscanSuffix = deviceId.startsWith('airscan:')
    ? deviceId.replace(/^airscan:w\d+:/, '')
    : null;
  const nameMatch = airscanSuffix
    && devices.some(d => d.id.startsWith('airscan:') && d.id.replace(/^airscan:w\d+:/, '') === airscanSuffix);
  if (!exactMatch && !nameMatch) {
    return res.status(400).json({ error: 'Unknown scanner device' });
  }
  const resolvedId = (nameMatch && !exactMatch)
    ? devices.find(d => d.id.startsWith('airscan:') && d.id.replace(/^airscan:w\d+:/, '') === airscanSuffix).id
    : deviceId;

  try {
    const pdf = await scan(resolvedId, resolution, mode, { source, skipBlank, paperSize });
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
