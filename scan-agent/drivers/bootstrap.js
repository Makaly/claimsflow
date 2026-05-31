'use strict';

/**
 * Driver bootstrap — Windows.
 *
 * WHY THIS EXISTS
 * ---------------
 * Scanner manufacturers "lock" their drivers behind per-vendor EULAs and, for
 * ISIS, a commercially licensed runtime (OpenText, formerly EMC/Pixel
 * Translations). We are NOT permitted to redistribute those files inside our
 * installer, and we never try to bypass that licensing.
 *
 * Instead we do the lawful thing: detect which scanner is physically attached
 * (USB VID/PID via PnP, plus the live eSCL/WIA device list) and then either
 *   (a) fetch the manufacturer's OWN driver package from its official source
 *       via winget — silent, signed, straight from the vendor, or
 *   (b) hand the user the official vendor download URL when no winget package
 *       exists (most model-specific TWAIN/ISIS drivers).
 *
 * The agent itself talks to scanners only through standard interfaces that ride
 * on top of whatever driver the user installed: WIA, eSCL/AirScan (driverless),
 * WSD, TWAIN (via NAPS2), and SANE. So "all drivers for Windows" is achieved
 * without ever shipping a locked file.
 *
 * SECURITY: install() only ever runs a winget id taken from the curated CATALOG
 * below — never a value derived from request input. No shell string is built
 * from user data.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const { platform } = require('os');

const execFileAsync = promisify(execFile);
const OS = platform();

// ── USB Vendor ID → vendor key ────────────────────────────────────────────────
// VIDs are assigned by USB-IF and are stable per manufacturer. We read them from
// the PnP HardwareID (USB\VID_xxxx&PID_yyyy) to identify the attached scanner
// even before any vendor driver is installed.
const USB_VID = {
  '04a9': 'canon',
  '04b8': 'epson',
  '03f0': 'hp',
  '04f9': 'brother',
  '040a': 'kodak',     // Eastman Kodak
  '1051': 'kodak',     // Kodak Alaris (i-series document scanners)
  '04c5': 'fujitsu',   // Fujitsu / PFU / Ricoh fi-series
  '05ca': 'ricoh',
  '0924': 'xerox',
  '0bda': 'generic',   // common controller; fall back to driverless
};

// ── Driver catalog ──────────────────────────────────────────────────────────
// `winget`  : official winget package id (installed silently, signed by vendor).
//             Present only where a single reliable package exists.
// `url`     : official vendor driver page — used when no winget package fits
//             (model-specific TWAIN/ISIS drivers must come from here).
// `protocol`: how the agent reaches devices from this vendor once set up.
// `note`    : shown in the UI.
//
// We are deliberately conservative about `winget` ids: only packages we are
// confident exist in the public winget repo are listed. Everything else routes
// to the vendor's official URL so we never assert a package that may 404.
const CATALOG = {
  // The universal TWAIN/ISIS bridge — MIT-licensed, freely redistributable,
  // and the recommended way to drive Canon/Kodak/Fujitsu/Xerox TWAIN sources.
  naps2: {
    label: 'NAPS2 (TWAIN / ISIS bridge)',
    winget: 'cyanfish.NAPS2',
    protocol: 'twain',
    note: 'Free, open-source. Lets the agent drive any installed TWAIN or ISIS scanner (Canon, Kodak Alaris, Fujitsu, Xerox, Ricoh).',
    redistributable: true,
  },
  // Mopria scan service — enables driverless eSCL/WSD scanning on Windows.
  mopria: {
    label: 'Mopria Scan (driverless network scanning)',
    winget: 'Mopria.ScanService',
    protocol: 'escl',
    note: 'Driverless eSCL/WSD scanning for most modern network MFPs. No vendor driver needed.',
    redistributable: true,
  },
  canon: {
    label: 'Canon scanner driver',
    url: 'https://www.usa.canon.com/support/software',
    protocol: 'twain|escl',
    note: 'imageRUNNER / imageCLASS / DR-series. Network models also work driverless via eSCL. Install the model-specific driver or ScanGear from Canon, then scan via NAPS2/TWAIN.',
    redistributable: false,
  },
  epson: {
    label: 'Epson Scan 2',
    winget: 'EpsonAmerica.EpsonScan2',
    url: 'https://epson.com/Support/sl/s',
    protocol: 'twain|escl',
    note: 'Epson WorkForce / DS-series. Network models also work driverless via eSCL.',
    redistributable: false,
  },
  hp: {
    label: 'HP scanner software',
    winget: 'HP.SmartTank',
    url: 'https://support.hp.com/us-en/drivers',
    protocol: 'escl|twain',
    note: 'Most HP MFPs scan driverless via eSCL. For full-feature TWAIN use HP Smart / Full Feature Software.',
    redistributable: false,
  },
  brother: {
    label: 'Brother iPrint&Scan',
    winget: 'Brother.iPrintAndScan',
    url: 'https://support.brother.com',
    protocol: 'escl|twain',
    note: 'Brother ADS / MFC-series. Network models scan driverless via eSCL.',
    redistributable: false,
  },
  kodak: {
    label: 'Kodak Alaris scanner software',
    url: 'https://support.alarisworld.com/en-us/drivers',
    protocol: 'isis|twain',
    note: 'Kodak Alaris i-series / S-series. Install the "Scanner Driver Software" (TWAIN+ISIS) from Alaris, then scan via NAPS2. ISIS is a licensed runtime and cannot be bundled.',
    redistributable: false,
  },
  fujitsu: {
    label: 'Fujitsu / Ricoh PaperStream IP',
    url: 'https://www.fujitsu.com/global/support/products/computing/peripheral/scanners/',
    protocol: 'isis|twain',
    note: 'fi-series / ScanSnap. Install PaperStream IP (TWAIN/ISIS) from Fujitsu/Ricoh, then scan via NAPS2.',
    redistributable: false,
  },
  ricoh: {
    label: 'Ricoh scanner driver',
    url: 'https://support.ricoh.com',
    protocol: 'escl|twain',
    note: 'Ricoh MFPs scan driverless via eSCL on the network; TWAIN driver from Ricoh for USB.',
    redistributable: false,
  },
  xerox: {
    label: 'Xerox scanner driver',
    url: 'https://www.support.xerox.com',
    protocol: 'twain|escl',
    note: 'Xerox WorkCentre / VersaLink. Network models scan driverless via eSCL.',
    redistributable: false,
  },
};

// ── winget availability ───────────────────────────────────────────────────────
async function isWingetAvailable() {
  if (OS !== 'win32') return false;
  try {
    await execFileAsync('winget', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ── Detect attached scanners (Windows PnP) ─────────────────────────────────────
/**
 * Returns [{ name, manufacturer, vid, pid, vendorKey, hardwareId }].
 * Reads imaging-class + scanner PnP devices and parses the USB VID/PID so we can
 * identify the vendor even when no driver is installed yet.
 */
async function detectScanners() {
  if (OS !== 'win32') return [];

  // PNPClass 'Image' covers WIA scanners/cameras; we also sweep names for
  // scanners enumerated under other classes (USBSTOR-style document scanners).
  const ps = [
    '$ErrorActionPreference="SilentlyContinue";',
    "$d = Get-PnpDevice | Where-Object { $_.Class -eq 'Image' -or $_.FriendlyName -match 'scan' };",
    '$out = foreach ($x in $d) {',
    "  $hid = ($x.HardwareID | Where-Object { $_ -match 'VID_' } | Select-Object -First 1);",
    '  [pscustomobject]@{',
    '    Name=$x.FriendlyName; Manufacturer=$x.Manufacturer;',
    '    Status=$x.Status; HardwareID=$hid; InstanceId=$x.InstanceId',
    '  }',
    '};',
    '$out | ConvertTo-Json -Depth 3',
  ].join(' ');

  let raw = '[]';
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 15_000 },
    );
    raw = stdout.trim() || '[]';
  } catch {
    return [];
  }

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) parsed = [parsed];

  return parsed.filter(Boolean).map((d) => {
    const hid = (d.HardwareID || '').toString();
    const vid = (hid.match(/VID_([0-9A-Fa-f]{4})/) || [])[1]?.toLowerCase() || null;
    const pid = (hid.match(/PID_([0-9A-Fa-f]{4})/) || [])[1]?.toLowerCase() || null;
    let vendorKey = vid ? USB_VID[vid] : null;
    // Fall back to a name match if the VID is unknown.
    if (!vendorKey) {
      const name = `${d.Name || ''} ${d.Manufacturer || ''}`.toLowerCase();
      vendorKey = Object.keys(CATALOG).find((k) => k !== 'naps2' && k !== 'mopria' && name.includes(k)) || null;
    }
    return {
      name: d.Name || 'Unknown imaging device',
      manufacturer: d.Manufacturer || null,
      status: d.Status || null,
      vid, pid, vendorKey,
      hardwareId: hid || null,
    };
  });
}

// ── Recommend which driver packages to install ─────────────────────────────────
/**
 * Cross-references the detected hardware against the catalog and returns an
 * ordered, de-duplicated list of recommended driver packages. NAPS2 + Mopria
 * are always recommended (they are the redistributable bridges that make every
 * other vendor reachable through a standard interface).
 */
async function recommendDrivers() {
  const detected = await detectScanners();
  const winget = await isWingetAvailable();

  const keys = new Set(['naps2', 'mopria']);
  for (const dev of detected) {
    if (dev.vendorKey && CATALOG[dev.vendorKey]) keys.add(dev.vendorKey);
  }

  const recommendations = [...keys].map((key) => {
    const entry = CATALOG[key];
    const matched = detected.filter((d) => d.vendorKey === key).map((d) => d.name);
    return {
      key,
      label: entry.label,
      method: entry.winget && winget ? 'winget' : 'manual',
      wingetId: entry.winget || null,
      url: entry.url || null,
      protocol: entry.protocol,
      note: entry.note,
      redistributable: !!entry.redistributable,
      matchedDevices: matched,
    };
  });

  return { wingetAvailable: winget, detected, recommendations };
}

// ── Install a driver package via winget ─────────────────────────────────────────
/**
 * Installs a catalog package by key. ONLY accepts keys present in CATALOG, and
 * only ever passes the catalog's own winget id to winget — request input never
 * reaches the command line. Returns { ok, method, log } or a manual fallback.
 */
async function installDriver(key) {
  const entry = CATALOG[key];
  if (!entry) return { ok: false, error: `Unknown driver key '${key}'` };

  if (!entry.winget) {
    return {
      ok: false,
      method: 'manual',
      url: entry.url,
      message: `${entry.label} has no winget package — install it from the official vendor page.`,
    };
  }
  if (!(await isWingetAvailable())) {
    return {
      ok: false,
      method: 'manual',
      url: entry.url || null,
      message: 'winget is not available on this machine. Install the App Installer from the Microsoft Store, or use the vendor URL.',
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      'winget',
      ['install', '--id', entry.winget, '--exact', '--silent',
        '--accept-package-agreements', '--accept-source-agreements',
        '--disable-interactivity'],
      { timeout: 600_000 },
    );
    return { ok: true, method: 'winget', wingetId: entry.winget, log: (stdout || stderr || '').slice(-4000) };
  } catch (err) {
    return {
      ok: false,
      method: 'winget',
      wingetId: entry.winget,
      url: entry.url || null,
      error: (err.stderr || err.stdout || err.message || '').toString().slice(-4000),
    };
  }
}

module.exports = {
  CATALOG,
  isWingetAvailable,
  detectScanners,
  recommendDrivers,
  installDriver,
};
