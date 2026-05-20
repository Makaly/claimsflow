#!/usr/bin/env node
/**
 * Generates all installer graphics for the ClaimsFlow Scan Agent installer.
 *
 * Outputs (all BMP for Inno Setup compatibility):
 *   assets/wizard-sidebar.bmp   — 164 × 314  Left panel image (classic wizard view)
 *   assets/wizard-header.bmp    — 497 × 58   Top banner (small pages)
 *   assets/setup-splash.bmp     — 614 × 386  Welcome page full background
 *
 * Also outputs PNGs for web use / preview:
 *   assets/wizard-sidebar.png
 *   assets/wizard-header.png
 *   assets/setup-splash.png
 *
 * Requires:  npm install canvas  (already in package.json)
 * Run:       node scripts/generate-installer-assets.js
 */

'use strict';

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

// ── Brand palette ────────────────────────────────────────────────────────────
const C = {
  bgDeep:    '#050B1A',   // near-black navy
  bgMid:     '#0A1628',   // dark navy
  bgCard:    '#0F1F3D',   // card surface
  accent:    '#2563EB',   // CIC blue
  accentAlt: '#3B82F6',   // lighter blue
  glow:      '#60A5FA',   // highlight glow
  teal:      '#0EA5E9',   // secondary accent
  white:     '#FFFFFF',
  offWhite:  '#E2E8F0',
  muted:     '#64748B',
  success:   '#10B981',
  gold:      '#F59E0B',
};

// ── Drawing helpers ──────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function glowCircle(ctx, cx, cy, r, color, alpha = 0.12) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, color.replace(')', `, ${alpha})`).replace('rgb', 'rgba').replace('#', 'rgba(').replace(/rgba\(([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/, (_, r, g, b) => `rgba(${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)}`));
  // Simple radial — use a solid with low opacity instead
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return { r, g, b };
}

function gradient(ctx, x1, y1, x2, y2, stops) {
  const g = ctx.createLinearGradient(x1, y1, x2, y2);
  stops.forEach(([pos, color]) => g.addColorStop(pos, color));
  return g;
}

function drawGrid(ctx, w, h, color = C.accent, alpha = 0.04, spacing = 32) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += spacing) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.restore();
}

function shieldIcon(ctx, cx, cy, size, fillColor) {
  ctx.save();
  ctx.translate(cx - size/2, cy - size/2);
  ctx.scale(size/24, size/24);
  ctx.beginPath();
  // Approximate shield path (shield check from lucide)
  ctx.moveTo(12, 2);
  ctx.lineTo(22, 6);
  ctx.lineTo(22, 12);
  ctx.bezierCurveTo(22, 17.5, 17.5, 21.5, 12, 22);
  ctx.bezierCurveTo(6.5, 21.5, 2, 17.5, 2, 12);
  ctx.lineTo(2, 6);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  // Checkmark
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 1.5 * (24/size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(8, 12); ctx.lineTo(11, 15); ctx.lineTo(16, 9);
  ctx.stroke();
  ctx.restore();
}

function drawDotPattern(ctx, x, y, w, h, color, dotR = 1, spacing = 12, alpha = 0.15) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let dx = x; dx < x + w; dx += spacing) {
    for (let dy = y; dy < y + h; dy += spacing) {
      ctx.beginPath();
      ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ── 1. Wizard Sidebar (164 × 314) ────────────────────────────────────────────
function makeSidebar() {
  const W = 164, H = 314;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Deep gradient background
  const bg = gradient(ctx, 0, 0, W, H, [
    [0,   C.bgDeep],
    [0.5, C.bgMid],
    [1,   '#0D1A3A'],
  ]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Grid overlay
  drawGrid(ctx, W, H, C.accent, 0.08, 20);

  // Dot pattern in lower right
  drawDotPattern(ctx, 80, 160, 90, 160, C.accentAlt, 1, 10, 0.2);

  // Large ambient circle (top)
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = C.accent;
  ctx.beginPath(); ctx.arc(82, 60, 90, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // Shield icon (centered, top third)
  ctx.save();
  ctx.globalAlpha = 0.9;
  shieldIcon(ctx, W/2, 72, 44, C.accent);
  ctx.restore();

  // "CF" monogram inside shield area as glow
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CF', W/2, 72);
  ctx.restore();

  // Product name
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('ClaimsFlow', W/2, 106);

  ctx.font = '9px sans-serif';
  ctx.fillStyle = C.glow;
  ctx.fillText('Scan Agent', W/2, 120);

  // Divider line
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = C.accentAlt;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(20, 138); ctx.lineTo(W-20, 138); ctx.stroke();
  ctx.restore();

  // Feature list
  const features = [
    { icon: '⬡', text: 'TWAIN / WIA / ISIS' },
    { icon: '⬡', text: 'Canon · Kodak · Fujitsu' },
    { icon: '⬡', text: 'eSCL Network Scanners' },
    { icon: '⬡', text: 'Runs as Windows Service' },
    { icon: '⬡', text: 'Auto PDF conversion' },
  ];

  features.forEach((f, i) => {
    const fy = 150 + i * 22;
    // Bullet circle
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.arc(28, fy + 6, 3, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    ctx.font = '9px sans-serif';
    ctx.fillStyle = C.offWhite;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(f.text, 38, fy);
  });

  // Bottom version tag
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.font = '8px sans-serif';
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'center';
  ctx.fillText('v1.1.0 · CIC Insurance Group', W/2, H - 16);
  ctx.restore();

  // Right edge accent line
  ctx.save();
  const edge = gradient(ctx, W-2, 0, W-2, H, [
    [0, 'transparent'], [0.5, C.accent], [1, 'transparent'],
  ]);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.moveTo(W-1, 0); ctx.lineTo(W-1, H); ctx.stroke();
  ctx.restore();

  return canvas;
}

// ── 2. Wizard Header Banner (497 × 58) ───────────────────────────────────────
function makeHeader() {
  const W = 497, H = 58;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = gradient(ctx, 0, 0, W, 0, [
    [0,    C.bgDeep],
    [0.6,  C.bgMid],
    [1,    '#0D1A3A'],
  ]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid
  drawGrid(ctx, W, H, C.accent, 0.06, 24);

  // Right-side ambient glow
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = C.teal;
  ctx.beginPath(); ctx.arc(W - 30, H/2, 60, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // Left shield icon (small)
  shieldIcon(ctx, 30, H/2, 24, C.accent);

  // Title text
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = C.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('ClaimsFlow Scan Agent', 58, H/2 - 7);

  ctx.font = '10px sans-serif';
  ctx.fillStyle = C.glow;
  ctx.fillText('CIC Insurance Group · Medical Claims Automation', 58, H/2 + 9);

  // Accent line at bottom
  const line = gradient(ctx, 0, H-2, W, H-2, [
    [0, 'transparent'], [0.3, C.accent], [0.7, C.teal], [1, 'transparent'],
  ]);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, H-1); ctx.lineTo(W, H-1); ctx.stroke();

  return canvas;
}

// ── 3. Splash / Welcome background (614 × 386) ───────────────────────────────
function makeSplash() {
  const W = 614, H = 386;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Deep background
  const bg = gradient(ctx, 0, 0, W, H, [
    [0,    C.bgDeep],
    [0.45, C.bgMid],
    [1,    '#081020'],
  ]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Grid
  drawGrid(ctx, W, H, C.accent, 0.06, 28);

  // Dot pattern (right half)
  drawDotPattern(ctx, W*0.5, 0, W*0.5, H, C.accentAlt, 1, 14, 0.12);

  // Large glow circles
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = C.accent;
  ctx.beginPath(); ctx.arc(W*0.75, H*0.35, 160, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = C.teal;
  ctx.beginPath(); ctx.arc(W*0.2, H*0.7, 120, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // Abstract "scanner" visual — stylised document stack
  const docX = W * 0.62, docY = H * 0.22, docW = 160, docH = 210;
  [0.6, 0.8, 1].forEach((a, i) => {
    ctx.save();
    ctx.globalAlpha = a * 0.12;
    ctx.fillStyle = C.accentAlt;
    roundRect(ctx, docX + i*6 - 12, docY + i*8 - 16, docW, docH, 6);
    ctx.fill();
    ctx.restore();
  });

  // Top document (lighter)
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = C.bgCard;
  roundRect(ctx, docX, docY, docW, docH, 6);
  ctx.fill();
  ctx.strokeStyle = C.accentAlt;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.3;
  ctx.stroke();
  ctx.restore();

  // Scan line animation representation
  ctx.save();
  ctx.globalAlpha = 0.5;
  const scanGrad = gradient(ctx, docX, docY + 80, docX + docW, docY + 80, [
    [0, 'transparent'], [0.3, C.teal], [0.7, C.accent], [1, 'transparent'],
  ]);
  ctx.strokeStyle = scanGrad;
  ctx.lineWidth = 2;
  ctx.shadowColor = C.teal;
  ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(docX, docY + 82); ctx.lineTo(docX + docW, docY + 82); ctx.stroke();
  ctx.restore();

  // Doc content lines
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = C.accentAlt;
  [30, 48, 66, 84, 108, 126].forEach(dy => {
    const lw = dy < 80 ? docW * 0.7 : docW * (0.4 + Math.random() * 0.3);
    roundRect(ctx, docX + 14, docY + dy, lw, 5, 2);
    ctx.fill();
  });
  ctx.restore();

  // Left panel — content area
  // Large shield
  ctx.save();
  ctx.globalAlpha = 0.9;
  shieldIcon(ctx, 80, 90, 56, C.accent);
  ctx.restore();

  // Headline
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = C.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowColor = C.accent;
  ctx.shadowBlur = 20;
  ctx.fillText('ClaimsFlow', 28, 130);
  ctx.shadowBlur = 0;

  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = C.glow;
  ctx.fillText('Scan Agent', 28, 156);

  ctx.font = '11px sans-serif';
  ctx.fillStyle = C.offWhite;
  ctx.globalAlpha = 0.8;
  const desc = 'Connects ClaimsFlow to your office scanner.';
  ctx.fillText(desc, 28, 192);
  ctx.fillText('Canon · Kodak · Fujitsu · Epson · HP · Xerox', 28, 210);

  ctx.restore();

  // Feature badges (horizontal strip near bottom)
  const badges = ['TWAIN/ISIS', 'eSCL/AirScan', 'Windows Service', 'Auto-PDF'];
  badges.forEach((label, i) => {
    const bx = 28 + i * 118, by = H - 72, bw = 108, bh = 26;
    // Badge background
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = C.accent;
    roundRect(ctx, bx, by, bw, bh, 13);
    ctx.fill();
    ctx.strokeStyle = C.accentAlt;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.restore();

    ctx.font = '9px sans-serif';
    ctx.fillStyle = C.glow;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw/2, by + bh/2);
  });

  // Copyright footer
  ctx.font = '8px sans-serif';
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'left';
  ctx.globalAlpha = 0.6;
  ctx.fillText('© 2026 CIC Insurance Group PLC · v1.1.0', 28, H - 18);

  return canvas;
}

// ── Save as PNG + BMP ────────────────────────────────────────────────────────
// NSIS/Inno Setup need BMP. We save PNG first then convert via raw BMP write.

function canvasToBmp(canvas) {
  const { width: W, height: H } = canvas;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, W, H);
  const pixels = imageData.data; // RGBA

  const rowSize = Math.ceil(W * 3 / 4) * 4; // 24bpp, padded to 4 bytes
  const pixelDataSize = rowSize * H;
  const fileSize = 54 + pixelDataSize;

  const buf = Buffer.alloc(fileSize, 0);

  // BMP File Header (14 bytes)
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);           // reserved
  buf.writeUInt32LE(54, 10);         // pixel data offset

  // DIB Header BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 14);         // header size
  buf.writeInt32LE(W, 18);
  buf.writeInt32LE(-H, 22);          // negative = top-down
  buf.writeUInt16LE(1, 26);          // color planes
  buf.writeUInt16LE(24, 28);         // bits per pixel
  buf.writeUInt32LE(0, 30);          // compression (none)
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeInt32LE(3780, 38);        // X pixels/meter (96 DPI)
  buf.writeInt32LE(3780, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  // Pixel data — BMP stores BGR, top-down (we use negative H)
  let offset = 54;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pi = (y * W + x) * 4;
      buf[offset++] = pixels[pi + 2]; // B
      buf[offset++] = pixels[pi + 1]; // G
      buf[offset++] = pixels[pi + 0]; // R
    }
    // Padding
    const pad = rowSize - W * 3;
    offset += pad;
  }

  return buf;
}

async function save(canvas, name) {
  const pngPath = path.join(ASSETS, `${name}.png`);
  const bmpPath = path.join(ASSETS, `${name}.bmp`);

  fs.writeFileSync(pngPath, canvas.toBuffer('image/png'));
  fs.writeFileSync(bmpPath, canvasToBmp(canvas));

  const pngKb = Math.round(fs.statSync(pngPath).size / 1024);
  const bmpKb = Math.round(fs.statSync(bmpPath).size / 1024);
  console.log(`  ✓ ${name}.png (${pngKb}KB)  +  ${name}.bmp (${bmpKb}KB)`);
}

async function main() {
  console.log('\nGenerating installer assets…\n');
  await save(makeSidebar(), 'wizard-sidebar');
  await save(makeHeader(),  'wizard-header');
  await save(makeSplash(),  'setup-splash');
  console.log(`\nAll assets written to: ${ASSETS}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
