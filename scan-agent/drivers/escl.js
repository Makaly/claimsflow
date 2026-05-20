'use strict';

/**
 * eSCL (Electronic Scan Communication Language) driver.
 *
 * Supported vendors: Canon (imageRUNNER, PIXMA, imageCLASS), Kodak Alaris
 * (S-series network scanners), Epson, Fujitsu, HP, Brother, Xerox — any
 * device that advertises _uscan._tcp or _uscans._tcp via mDNS.
 *
 * Protocol reference: Mopria Alliance eSCL 2.x specification.
 * All communication is plain HTTP(S) to the scanner's local IP.
 */

const http  = require('http');
const https = require('https');
const { tmpdir } = require('os');
const { join }   = require('path');
const { randomUUID } = require('crypto');
const { readFile, unlink } = require('fs/promises');
const { createWriteStream } = require('fs');

// ── mDNS discovery ─────────────────────────────────────────────────────────
// Uses the system `dns-sd` (macOS/Windows) or `avahi-browse` (Linux) CLI.
// Returns array of { name, host, port, secure, path } scanner records.
async function discoverEsclDevices(timeoutMs = 5000) {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const exec = promisify(execFile);
  const { platform } = require('os');
  const os = platform();

  const devices = [];

  try {
    if (os === 'darwin' || os === 'win32') {
      // dns-sd available on macOS natively; installed with Bonjour on Windows
      const { stdout } = await exec(
        'dns-sd',
        ['-B', '_uscan._tcp,_uscans._tcp', 'local.'],
        { timeout: timeoutMs },
      ).catch(() => ({ stdout: '' }));

      for (const line of stdout.split('\n')) {
        // Parse: Add   2   1 _uscan._tcp.     local. Canon MF753Cdw
        const m = line.match(/Add\s+\d+\s+\d+\s+(_u?scans?\._tcp)\.\s+local\.\s+(.+)/);
        if (m) {
          devices.push({ name: m[2].trim(), protocol: m[1], host: null, port: 80 });
        }
      }
    } else {
      // Linux: avahi-browse
      const { stdout } = await exec(
        'avahi-browse',
        ['-t', '-r', '-p', '_uscan._tcp'],
        { timeout: timeoutMs },
      ).catch(() => ({ stdout: '' }));

      for (const line of stdout.split('\n')) {
        // =;eth0;IPv4;Canon MF753Cdw;_uscan._tcp;local;scanner.local;192.168.1.100;80;...
        const parts = line.split(';');
        if (parts[0] === '=' && parts.length >= 9) {
          devices.push({
            name: parts[3],
            host: parts[7],
            port: parseInt(parts[8]) || 80,
            secure: false,
            path: '/eSCL',
          });
        }
      }
    }
  } catch { /* mDNS not available — return empty */ }

  return devices;
}

// ── Direct eSCL scanner access ─────────────────────────────────────────────
// Given a scanner base URL (e.g. http://192.168.1.100/eSCL), performs the
// full eSCL scan workflow: capabilities → create job → fetch image → delete job.

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { ...options, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getCapabilities(baseUrl) {
  const res = await fetch(`${baseUrl}/ScannerCapabilities`);
  if (res.status !== 200) throw new Error(`eSCL capabilities failed: HTTP ${res.status}`);
  return res.body.toString();
}

async function createScanJob(baseUrl, resolution, colorMode, source = 'Platen') {
  // eSCL color modes: BlackAndWhite1, Grayscale8, RGB24
  const esclColorMode = colorMode === 'Color' ? 'RGB24'
    : colorMode === 'Gray' ? 'Grayscale8'
    : 'BlackAndWhite1';

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"
                   xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.6</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
      <pwg:Height>4200</pwg:Height>
      <pwg:Width>3300</pwg:Width>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>${source}</pwg:InputSource>
  <scan:ColorMode>${esclColorMode}</scan:ColorMode>
  <scan:XResolution>${resolution}</scan:XResolution>
  <scan:YResolution>${resolution}</scan:YResolution>
  <pwg:DocumentFormat>application/pdf</pwg:DocumentFormat>
</scan:ScanSettings>`;

  const res = await fetch(`${baseUrl}/ScanJobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(body) },
    body,
  });

  if (res.status !== 201) {
    throw new Error(`eSCL job creation failed: HTTP ${res.status} — ${res.body.toString().slice(0, 200)}`);
  }

  // Location header contains the job URI
  const location = res.headers['location'];
  if (!location) throw new Error('eSCL: no Location header in scan job response');
  return location; // full job URL
}

async function fetchDocument(jobUrl, outputPath) {
  const docUrl = `${jobUrl}/NextDocument`;
  const res = await fetch(docUrl, { method: 'GET' });

  if (res.status === 404) throw new Error('eSCL: no document ready — scanner may be empty or jammed');
  if (res.status !== 200) throw new Error(`eSCL document fetch failed: HTTP ${res.status}`);

  const { writeFile } = require('fs/promises');
  await writeFile(outputPath, res.body);
}

async function deleteJob(jobUrl) {
  await fetch(jobUrl, { method: 'DELETE' }).catch(() => {});
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * List eSCL scanners known by their base URLs.
 * baseUrls: array of strings like ['http://192.168.1.100/eSCL']
 * Also includes mDNS-discovered devices when avahi/dns-sd is available.
 */
async function listEsclDevices(configuredUrls = []) {
  const devices = [];

  // Static/configured devices (set via ESCL_SCANNERS env var, comma-separated)
  const envUrls = process.env.ESCL_SCANNERS
    ? process.env.ESCL_SCANNERS.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  for (const url of [...configuredUrls, ...envUrls]) {
    try {
      const cap = await getCapabilities(url);
      // Extract make/model from XML
      const makeModel = cap.match(/<scan:MakeAndModel>([^<]+)<\/scan:MakeAndModel>/)?.[1]
        ?? cap.match(/<pwg:MakeAndModel>([^<]+)<\/pwg:MakeAndModel>/)?.[1]
        ?? 'Network Scanner';
      const vendor = makeModel.split(' ')[0] ?? 'Unknown';
      devices.push({
        id: `escl:${url}`,
        name: makeModel,
        vendor,
        model: makeModel,
        type: 'network',
        driver: 'escl',
        baseUrl: url,
      });
    } catch { /* unreachable scanner — skip */ }
  }

  // mDNS-discovered devices (best-effort)
  const mdns = await discoverEsclDevices(3000).catch(() => []);
  for (const d of mdns) {
    if (d.host) {
      const url = `http://${d.host}:${d.port}/eSCL`;
      if (!devices.find(x => x.baseUrl === url)) {
        devices.push({
          id: `escl:${url}`,
          name: d.name,
          vendor: d.name.split(' ')[0] ?? 'Unknown',
          model: d.name,
          type: 'network',
          driver: 'escl',
          baseUrl: url,
        });
      }
    }
  }

  return devices;
}

/**
 * Scan using eSCL protocol.
 * deviceId: 'escl:http://192.168.1.100/eSCL'
 */
async function scanEscl(deviceId, resolution, colorMode, source = 'Platen') {
  const baseUrl = deviceId.replace(/^escl:/, '');
  const outPath  = join(tmpdir(), `cfa-escl-${randomUUID()}.pdf`);
  let jobUrl = null;
  try {
    jobUrl = await createScanJob(baseUrl, resolution, colorMode, source);
    // Brief pause — scanner needs a moment to initialise the scan
    await new Promise(r => setTimeout(r, 1500));
    await fetchDocument(jobUrl, outPath);
    return await readFile(outPath);
  } finally {
    if (jobUrl) await deleteJob(jobUrl);
    await unlink(outPath).catch(() => {});
  }
}

module.exports = { listEsclDevices, scanEscl };
