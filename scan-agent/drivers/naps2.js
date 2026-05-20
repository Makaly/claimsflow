'use strict';

/**
 * NAPS2 (Not Another PDF Scanner 2) driver — Windows & macOS.
 *
 * NAPS2 is a free, open-source scanning application that exposes a CLI
 * capable of driving TWAIN, WIA, and SANE scanners. This is the recommended
 * way to talk to professional scanners from Canon (imageCLASS, imageRUNNER),
 * Kodak/Alaris (S-series, i-series), Fujitsu (ScanSnap, fi-series),
 * Xerox, and Ricoh — any scanner with a TWAIN or ISIS driver installed.
 *
 * Installation:
 *   Windows: winget install cyanfish.naps2  (or download from naps2.com)
 *   macOS:   brew install --cask naps2
 *
 * NAPS2 CLI reference: https://www.naps2.com/doc/cli
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const { tmpdir } = require('os');
const { join }   = require('path');
const { randomUUID } = require('crypto');
const { readFile, unlink, writeFile } = require('fs/promises');
const { platform } = require('os');

const execAsync = promisify(execFile);
const OS = platform();

// ── Locate the naps2 binary ─────────────────────────────────────────────────
function naps2Binary() {
  if (process.env.NAPS2_PATH) return process.env.NAPS2_PATH;
  if (OS === 'win32') {
    // Common install locations
    const candidates = [
      'C:\\Program Files\\NAPS2\\naps2.exe',
      'C:\\Program Files (x86)\\NAPS2\\naps2.exe',
      join(process.env.LOCALAPPDATA || '', 'Programs', 'NAPS2', 'naps2.exe'),
    ];
    const fs = require('fs');
    return candidates.find(p => fs.existsSync(p)) ?? 'naps2';
  }
  // macOS / Linux: expect naps2 on PATH (brew / package manager)
  return 'naps2';
}

// ── TWAIN driver ── (Canon, Kodak, Fujitsu, Xerox, etc.) ───────────────────
async function isNaps2Available() {
  try {
    await execAsync(naps2Binary(), ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * List TWAIN devices visible to NAPS2.
 * Returns [{id, name, vendor, model, type, driver}]
 */
async function listNaps2Devices(driverType = 'twain') {
  const bin = naps2Binary();
  try {
    const { stdout } = await execAsync(bin, ['list-devices', '--driver', driverType], { timeout: 15000 });
    return stdout.trim().split('\n').filter(Boolean).map((line, i) => {
      // Output format: "Canon MF753Cdw" or "KODAK S2060 Scanner"
      const name = line.trim();
      const vendor = name.split(' ')[0] ?? 'Unknown';
      return {
        id: `naps2:${driverType}:${name}`,
        name,
        vendor,
        model: name,
        type: 'flatbed',
        driver: `naps2-${driverType}`,
      };
    });
  } catch {
    return [];
  }
}

/**
 * All devices NAPS2 can see across all driver types.
 * Priority order: ISIS (Kodak/Fujitsu professional) → TWAIN → WIA → SANE.
 * ISIS is checked separately because Kodak Alaris S/i-series install ISIS
 * drivers by default and may NOT appear in the TWAIN list.
 */
async function listAllNaps2Devices() {
  if (!(await isNaps2Available())) return [];

  // ISIS is Windows-only; required for Kodak Alaris, some Fujitsu models
  const drivers = OS === 'win32'  ? ['isis', 'twain', 'wia']
    : OS === 'darwin' ? ['twain', 'apple']
    : ['sane'];

  const results = await Promise.all(drivers.map(d => listNaps2Devices(d)));
  const seen = new Set();
  return results.flat().filter(d => {
    if (seen.has(d.name)) return false; // deduplicate by name across driver types
    seen.add(d.name);
    return true;
  });
}

// ── Vendor-specific NAPS2 profiles ─────────────────────────────────────────
// These translate ClaimsFlow scan settings to optimal NAPS2 CLI flags per brand.

function canonProfile(resolution, colorMode) {
  // Canon TWAIN drivers support up to 600 DPI on flatbed, 300 on ADF.
  // Force ADF duplex when resolution ≤ 300 — optimal for invoice batches.
  return [
    '--dpi', String(resolution),
    '--color-mode', colorMode === 'Color' ? 'color' : colorMode === 'Gray' ? 'gray' : 'bw',
    '--page-size', 'a4',
    '--compress', 'jpeg',   // Canon JPEG compression is high quality
    '--jpeg-quality', '92',
  ];
}

function kodakProfile(resolution, colorMode) {
  // Kodak Alaris scanners excel at high-speed duplex ADF scanning.
  // Their TWAIN driver supports blank-page detection.
  return [
    '--dpi', String(resolution),
    '--color-mode', colorMode === 'Color' ? 'color' : colorMode === 'Gray' ? 'gray' : 'bw',
    '--page-size', 'a4',
    '--source', 'feeder',   // Kodak's strength is ADF
    '--duplex',
    '--compress', 'jpeg',
    '--jpeg-quality', '90',
  ];
}

function fujitsuProfile(resolution, colorMode) {
  // Fujitsu PaperStream/fi-series: excellent image processing built into driver.
  return [
    '--dpi', String(resolution),
    '--color-mode', colorMode === 'Color' ? 'color' : colorMode === 'Gray' ? 'gray' : 'bw',
    '--page-size', 'a4',
    '--source', 'feeder',
    '--duplex',
    '--compress', 'jpeg',
    '--jpeg-quality', '95',
  ];
}

function genericProfile(resolution, colorMode) {
  return [
    '--dpi', String(resolution),
    '--color-mode', colorMode === 'Color' ? 'color' : colorMode === 'Gray' ? 'gray' : 'bw',
    '--page-size', 'a4',
  ];
}

function vendorProfile(deviceName, resolution, colorMode) {
  const n = (deviceName || '').toLowerCase();
  if (n.includes('canon'))   return canonProfile(resolution, colorMode);
  if (n.includes('kodak') || n.includes('alaris')) return kodakProfile(resolution, colorMode);
  if (n.includes('fujitsu') || n.includes('scansnap') || n.includes('fi-')) return fujitsuProfile(resolution, colorMode);
  return genericProfile(resolution, colorMode);
}

// ── Scan ────────────────────────────────────────────────────────────────────

/**
 * Scan using NAPS2.
 * deviceId: 'naps2:twain:Canon MF753Cdw'
 */
async function scanNaps2(deviceId, resolution, colorMode) {
  // Parse: naps2:<driver>:<device name>
  const [, driverType, ...nameParts] = deviceId.split(':');
  const deviceName = nameParts.join(':');

  const outPath = join(tmpdir(), `cfa-naps2-${randomUUID()}.pdf`);
  const bin = naps2Binary();

  const vendorFlags = vendorProfile(deviceName, resolution, colorMode);

  try {
    await execAsync(bin, [
      'scan',
      '--driver',  driverType,
      '--device',  deviceName,
      '--output',  outPath,
      '--format',  'pdf',
      ...vendorFlags,
    ], { timeout: 120_000 });

    return await readFile(outPath);
  } finally {
    await unlink(outPath).catch(() => {});
  }
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

/**
 * Returns a human-readable diagnosis when a Kodak/professional scanner fails.
 * Checks whether NAPS2 is installed and whether ISIS drivers are present.
 */
async function diagnoseWindows() {
  const bin = naps2Binary();
  const fs  = require('fs');

  const naps2Installed = await isNaps2Available();
  const isisDrivers = [];
  const twainDrivers = [];

  if (naps2Installed) {
    try {
      const { stdout: i } = await execAsync(bin, ['list-devices', '--driver', 'isis'], { timeout: 10000 }).catch(() => ({ stdout: '' }));
      isisDrivers.push(...i.trim().split('\n').filter(Boolean));
    } catch {}
    try {
      const { stdout: t } = await execAsync(bin, ['list-devices', '--driver', 'twain'], { timeout: 10000 }).catch(() => ({ stdout: '' }));
      twainDrivers.push(...t.trim().split('\n').filter(Boolean));
    } catch {}
  }

  return {
    naps2Installed,
    naps2Path: bin,
    isisDevices: isisDrivers,
    twainDevices: twainDrivers,
    recommendations: [
      !naps2Installed && 'Install NAPS2: winget install cyanfish.naps2  (required for Kodak, Fujitsu, Canon TWAIN)',
      isisDrivers.length === 0 && naps2Installed && 'No ISIS devices found. For Kodak Alaris scanners install "Alaris S2000/S3000 Series Scanner Software" from the Kodak Alaris website.',
      twainDrivers.length === 0 && naps2Installed && 'No TWAIN devices found. Install the manufacturer TWAIN driver (Canon MF/imageRUNNER drivers from canon.com, Kodak Alaris from alarisworld.com).',
    ].filter(Boolean),
  };
}

module.exports = { isNaps2Available, listAllNaps2Devices, scanNaps2, diagnoseWindows };
