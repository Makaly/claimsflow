#!/usr/bin/env node
/**
 * Generates installer graphics for ClaimsFlow Scan Agent.
 * Pure JavaScript — no native dependencies, no canvas required.
 *
 * Outputs:
 *   assets/wizard-sidebar.bmp   164 × 314  Left wizard panel
 *   assets/wizard-header.bmp    497 × 58   Inner-page header banner
 *   assets/setup-splash.bmp     614 × 386  Welcome page background
 *
 * Run:  node scripts/generate-installer-assets.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ASSETS = path.resolve(__dirname, '..', 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

// ── Colour helpers ────────────────────────────────────────────────────────────

function hex(h) {
  return { r: parseInt(h.slice(1,3),16), g: parseInt(h.slice(3,5),16), b: parseInt(h.slice(5,7),16) };
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function lerpColor(c1, c2, t) {
  return { r: lerp(c1.r, c2.r, t), g: lerp(c1.g, c2.g, t), b: lerp(c1.b, c2.b, t) };
}

// Clamp 0–255
function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

// ── Brand palette ─────────────────────────────────────────────────────────────
const P = {
  bgDeep:   hex('#050B1A'),
  bgMid:    hex('#0A1628'),
  bgCard:   hex('#0F1F3D'),
  accent:   hex('#2563EB'),
  accentLt: hex('#3B82F6'),
  glow:     hex('#60A5FA'),
  teal:     hex('#0EA5E9'),
  white:    hex('#FFFFFF'),
  offWhite: hex('#E2E8F0'),
  muted:    hex('#475569'),
  gold:     hex('#F59E0B'),
  success:  hex('#10B981'),
};

// ── Pixel buffer ──────────────────────────────────────────────────────────────

class Bitmap {
  constructor(w, h) {
    this.w = w; this.h = h;
    // RGBA stored row-major
    this.data = new Uint8ClampedArray(w * h * 4).fill(0);
    // Pre-fill alpha to 255
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
  }

  idx(x, y) { return (y * this.w + x) * 4; }

  setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const i = this.idx(x, y);
    // Alpha blend over existing
    const aa = a / 255;
    this.data[i  ] = clamp(this.data[i  ] * (1-aa) + r * aa);
    this.data[i+1] = clamp(this.data[i+1] * (1-aa) + g * aa);
    this.data[i+2] = clamp(this.data[i+2] * (1-aa) + b * aa);
    this.data[i+3] = 255;
  }

  // Vertical gradient fill on full or partial width/height
  gradV(x0, y0, x1, y1, c1, c2) {
    for (let y = y0; y < y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0 - 1);
      const c = lerpColor(c1, c2, t);
      for (let x = x0; x < x1; x++) this.setPixel(x, y, c.r, c.g, c.b);
    }
  }

  // Horizontal gradient
  gradH(x0, y0, x1, y1, c1, c2) {
    for (let x = x0; x < x1; x++) {
      const t = (x - x0) / Math.max(1, x1 - x0 - 1);
      const c = lerpColor(c1, c2, t);
      for (let y = y0; y < y1; y++) this.setPixel(x, y, c.r, c.g, c.b);
    }
  }

  // Filled rect with alpha
  rect(x0, y0, w, h, c, a = 255) {
    for (let y = y0; y < y0+h; y++)
      for (let x = x0; x < x0+w; x++)
        this.setPixel(x, y, c.r, c.g, c.b, a);
  }

  // Horizontal line
  hline(y, x0, x1, c, a = 255) {
    for (let x = x0; x <= x1; x++) this.setPixel(x, y, c.r, c.g, c.b, a);
  }

  // Vertical line
  vline(x, y0, y1, c, a = 255) {
    for (let y = y0; y <= y1; y++) this.setPixel(x, y, c.r, c.g, c.b, a);
  }

  // Filled circle
  circle(cx, cy, r, c, a = 255) {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++)
        if (x*x + y*y <= r*r)
          this.setPixel(cx+x, cy+y, c.r, c.g, c.b, a);
  }

  // Radial glow (soft circle fade)
  glow(cx, cy, r, c, maxAlpha = 60) {
    for (let y = cy-r; y <= cy+r; y++)
      for (let x = cx-r; x <= cx+r; x++) {
        const d = Math.sqrt((x-cx)**2 + (y-cy)**2);
        if (d > r) continue;
        const a = Math.round(maxAlpha * (1 - d/r) ** 2);
        this.setPixel(x, y, c.r, c.g, c.b, a);
      }
  }

  // Regular dot grid (subtle tech texture)
  dotGrid(x0, y0, x1, y1, spacing, c, a = 30) {
    for (let y = y0; y < y1; y += spacing)
      for (let x = x0; x < x1; x += spacing)
        this.setPixel(x, y, c.r, c.g, c.b, a);
  }

  // Grid lines
  gridLines(x0, y0, x1, y1, spacing, c, a = 18) {
    for (let x = x0; x < x1; x += spacing) this.vline(x, y0, y1-1, c, a);
    for (let y = y0; y < y1; y += spacing) this.hline(y, x0, x1-1, c, a);
  }

  // Rounded-rect stroke (border only)
  strokeRect(x0, y0, w, h, c, a = 180) {
    this.hline(y0,       x0, x0+w-1, c, a);
    this.hline(y0+h-1,   x0, x0+w-1, c, a);
    this.vline(x0,       y0, y0+h-1, c, a);
    this.vline(x0+w-1,   y0, y0+h-1, c, a);
  }

  // Simple 5×7 pixel font (0-9, A-Z, space, colon, dot, ·, /)
  // Characters are 5px wide × 7px tall
  drawChar(cx, cy, ch, c, a = 255, scale = 1) {
    const map = FONT[ch.toUpperCase()];
    if (!map) return cx + (5 + 1) * scale;
    for (let row = 0; row < 7; row++) {
      const bits = map[row] || 0;
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++)
              this.setPixel(cx + col*scale + dx, cy + row*scale + dy, c.r, c.g, c.b, a);
        }
      }
    }
    return cx + (5 + 1) * scale;
  }

  drawText(x, y, text, c, a = 255, scale = 1) {
    let cx = x;
    for (const ch of text) cx = this.drawChar(cx, y, ch, c, a, scale);
    return cx;
  }

  // Export as 24-bit BMP buffer
  toBmp() {
    const { w, h } = this;
    const rowSize   = Math.ceil(w * 3 / 4) * 4;
    const pixBytes  = rowSize * h;
    const buf = Buffer.alloc(54 + pixBytes, 0);
    buf.write('BM', 0, 'ascii');
    buf.writeUInt32LE(54 + pixBytes, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(w, 18);
    buf.writeInt32LE(h, 22);    // positive = bottom-up (universal; NSIS MUI needs this)
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28);
    buf.writeUInt32LE(0, 30);
    buf.writeUInt32LE(pixBytes, 34);
    buf.writeInt32LE(3780, 38);
    buf.writeInt32LE(3780, 42);
    let offset = 54;
    // Bottom-up: write the last row first.
    for (let y = h - 1; y >= 0; y--) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        buf[offset++] = this.data[i+2]; // B
        buf[offset++] = this.data[i+1]; // G
        buf[offset++] = this.data[i+0]; // R
      }
      offset += rowSize - w * 3;
    }
    return buf;
  }
}

// ── Minimal 5×7 pixel font ────────────────────────────────────────────────────
// Each character is an array of 7 rows; each row is a 5-bit bitmask.
const FONT = {
  'A': [0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
  'B': [0b11110,0b10001,0b10001,0b11110,0b10001,0b10001,0b11110],
  'C': [0b01110,0b10001,0b10000,0b10000,0b10000,0b10001,0b01110],
  'D': [0b11110,0b10001,0b10001,0b10001,0b10001,0b10001,0b11110],
  'E': [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b11111],
  'F': [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b10000],
  'G': [0b01110,0b10001,0b10000,0b10111,0b10001,0b10001,0b01111],
  'H': [0b10001,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
  'I': [0b01110,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],
  'J': [0b00111,0b00010,0b00010,0b00010,0b00010,0b10010,0b01100],
  'K': [0b10001,0b10010,0b10100,0b11000,0b10100,0b10010,0b10001],
  'L': [0b10000,0b10000,0b10000,0b10000,0b10000,0b10000,0b11111],
  'M': [0b10001,0b11011,0b10101,0b10001,0b10001,0b10001,0b10001],
  'N': [0b10001,0b11001,0b10101,0b10011,0b10001,0b10001,0b10001],
  'O': [0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
  'P': [0b11110,0b10001,0b10001,0b11110,0b10000,0b10000,0b10000],
  'Q': [0b01110,0b10001,0b10001,0b10001,0b10101,0b10010,0b01101],
  'R': [0b11110,0b10001,0b10001,0b11110,0b10100,0b10010,0b10001],
  'S': [0b01111,0b10000,0b10000,0b01110,0b00001,0b00001,0b11110],
  'T': [0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100],
  'U': [0b10001,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
  'V': [0b10001,0b10001,0b10001,0b10001,0b01010,0b01010,0b00100],
  'W': [0b10001,0b10001,0b10001,0b10101,0b10101,0b11011,0b10001],
  'X': [0b10001,0b10001,0b01010,0b00100,0b01010,0b10001,0b10001],
  'Y': [0b10001,0b10001,0b01010,0b00100,0b00100,0b00100,0b00100],
  'Z': [0b11111,0b00001,0b00010,0b00100,0b01000,0b10000,0b11111],
  '0': [0b01110,0b10001,0b10011,0b10101,0b11001,0b10001,0b01110],
  '1': [0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110],
  '2': [0b01110,0b10001,0b00001,0b00110,0b01000,0b10000,0b11111],
  '3': [0b11111,0b00010,0b00100,0b00110,0b00001,0b10001,0b01110],
  '4': [0b00010,0b00110,0b01010,0b10010,0b11111,0b00010,0b00010],
  '5': [0b11111,0b10000,0b11110,0b00001,0b00001,0b10001,0b01110],
  '6': [0b00110,0b01000,0b10000,0b11110,0b10001,0b10001,0b01110],
  '7': [0b11111,0b00001,0b00010,0b00100,0b00100,0b00100,0b00100],
  '8': [0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110],
  '9': [0b01110,0b10001,0b10001,0b01111,0b00001,0b00010,0b01100],
  ' ': [0,0,0,0,0,0,0],
  '.': [0,0,0,0,0,0b00100,0],
  ':': [0,0b00100,0,0,0,0b00100,0],
  '-': [0,0,0,0b11111,0,0,0],
  '/': [0b00001,0b00010,0b00100,0b00100,0b01000,0b10000,0b10000],
  '·': [0,0,0,0b00100,0,0,0],
  '©': [0b01110,0b10001,0b10110,0b10100,0b10110,0b10001,0b01110],
  '(': [0b00010,0b00100,0b01000,0b01000,0b01000,0b00100,0b00010],
  ')': [0b01000,0b00100,0b00010,0b00010,0b00010,0b00100,0b01000],
  ',': [0,0,0,0,0b00100,0b00100,0b01000],
};

// ── Shared background helper ──────────────────────────────────────────────────
function paintBg(bm) {
  // Deep navy-to-midnight vertical gradient
  bm.gradV(0, 0, bm.w, bm.h, P.bgDeep, hex('#0D1A3A'));
  // Subtle grid overlay
  bm.gridLines(0, 0, bm.w, bm.h, 24, P.accentLt, 14);
}

// ── Accent line helper (horizontal gradient bar) ──────────────────────────────
function accentBar(bm, y, w = bm.w) {
  // Fades in from left, peaks at center, fades out
  for (let x = 0; x < w; x++) {
    const t   = x / (w - 1);
    const tri = 1 - Math.abs(t - 0.5) * 2;   // 0→1→0
    const a   = Math.round(tri * 180);
    const c   = lerpColor(P.accent, P.teal, t);
    bm.setPixel(x, y,   c.r, c.g, c.b, a);
    bm.setPixel(x, y-1, c.r, c.g, c.b, Math.round(a * 0.4));
  }
}

// ── 1. Wizard sidebar (164 × 314) ─────────────────────────────────────────────
function makeSidebar() {
  const bm = new Bitmap(164, 314);
  paintBg(bm);

  // Dot-grid texture (right half, lower portion)
  bm.dotGrid(82, 140, 164, 314, 10, P.accentLt, 28);

  // Large ambient glow — top centre
  bm.glow(82, 55, 72, P.accent, 40);

  // Shield outline (simple polygon, 38px)
  const sx = 82, sy = 58, sr = 22;
  // Shield: draw filled blue circle as base
  bm.circle(sx, sy, sr, P.accent, 200);
  bm.circle(sx, sy, sr-3, P.bgMid, 200);
  bm.circle(sx, sy, sr-4, P.accent, 80);
  // "CF" monogram
  const cfW = 5*2*2 + 2 + 6;  // two chars × scale 2
  const cfX = sx - cfW/2;
  bm.drawText(cfX, sy - 7, 'CF', P.white, 220, 2);

  // Product name  "CLAIMSFLOW"
  bm.drawText(23, 90, 'CLAIMSFLOW', P.white, 210, 2);
  // Subtitle
  bm.drawText(42, 103, 'SCAN AGENT', P.glow, 180, 1);

  // Thin divider
  accentBar(bm, 118);

  // Feature list (5 items, pixel-font)
  const feats = [
    'TWAIN / WIA / ISIS',
    'CANON  KODAK  FUJI',
    'ESCL NETWORK SCAN',
    'WINDOWS SERVICE',
    'AUTO PDF OUTPUT',
  ];
  feats.forEach((f, i) => {
    const fy = 130 + i * 22;
    // Bullet dot
    bm.circle(20, fy + 4, 2, P.accent, 200);
    bm.drawText(28, fy, f, P.offWhite, 170, 1);
  });

  // Version tag at bottom
  bm.drawText(18, 295, 'V1.1.0  CIC INSURANCE', P.muted, 130, 1);

  // Right-edge accent stripe (2px, gradient opacity)
  for (let y = 0; y < 314; y++) {
    const tri = 1 - Math.abs(y/314 - 0.5) * 2;
    const a   = Math.round(tri * 140);
    bm.setPixel(162, y, P.accent.r, P.accent.g, P.accent.b, a);
    bm.setPixel(163, y, P.accent.r, P.accent.g, P.accent.b, Math.round(a * 0.4));
  }

  return bm;
}

// ── 2. Wizard header banner (497 × 58) ───────────────────────────────────────
function makeHeader() {
  const bm = new Bitmap(497, 58);
  paintBg(bm);

  // Right-side teal glow
  bm.glow(470, 29, 55, P.teal, 30);

  // Small shield icon (left side)
  bm.circle(30, 29, 16, P.accent, 180);
  bm.circle(30, 29, 13, P.bgMid, 180);
  bm.drawText(26, 25, 'CF', P.white, 210, 1);

  // Title
  bm.drawText(55, 14, 'CLAIMSFLOW SCAN AGENT', P.white, 220, 2);
  // Subtitle
  bm.drawText(56, 34, 'CIC INSURANCE GROUP  MEDICAL CLAIMS AUTOMATION', P.glow, 160, 1);

  // Bottom accent bar
  accentBar(bm, 56);
  accentBar(bm, 57);

  return bm;
}

// ── 3. Welcome splash (614 × 386) ─────────────────────────────────────────────
function makeSplash() {
  const bm = new Bitmap(614, 386);
  paintBg(bm);

  // Extra dot grid right panel
  bm.dotGrid(320, 0, 614, 386, 12, P.accentLt, 20);

  // Right ambient glow
  bm.glow(470, 145, 140, P.accent, 30);
  bm.glow(560, 300, 100, P.teal, 22);
  bm.glow(80,  280, 100, P.teal, 18);

  // ── Abstract document stack (right side) ──────────────────────────────────
  const dx = 400, dy = 60, dw = 160, dh = 200;

  // Shadow layers
  [[12,16,40],[6,8,60],[0,0,90]].forEach(([ox,oy,a]) => {
    bm.rect(dx+ox, dy+oy, dw, dh, P.bgCard, a);
    bm.strokeRect(dx+ox, dy+oy, dw, dh, P.accentLt, Math.round(a*0.4));
  });

  // Document surface
  bm.rect(dx, dy, dw, dh, P.bgCard, 140);
  bm.strokeRect(dx, dy, dw, dh, P.accentLt, 80);

  // Doc content lines
  const lineAlpha = 55;
  [20,32,44,56,74,86,98,110].forEach(ly => {
    const lw = ly < 60 ? 120 : 60 + (ly % 30);
    bm.rect(dx+14, dy+ly, lw, 4, P.accentLt, lineAlpha);
  });

  // Scan-line effect across the doc
  for (let x = dx; x < dx+dw; x++) {
    const a = 120 * Math.sin(((x-dx)/(dw-1)) * Math.PI) | 0;
    bm.setPixel(x, dy+78, P.teal.r, P.teal.g, P.teal.b, a);
    bm.setPixel(x, dy+79, P.teal.r, P.teal.g, P.teal.b, Math.round(a*0.5));
    // Glow above/below scan line
    [-2,-1,1,2].forEach(off => {
      bm.setPixel(x, dy+78+off, P.teal.r, P.teal.g, P.teal.b, Math.round(a*0.15));
    });
  }

  // ── Left panel — branding ─────────────────────────────────────────────────
  // Large shield
  bm.glow(68, 80, 52, P.accent, 50);
  bm.circle(68, 80, 36, P.accent, 190);
  bm.circle(68, 80, 30, P.bgMid, 190);
  // CF monogram (scale 3)
  bm.drawText(51, 72, 'CF', P.white, 230, 3);

  // Headline
  bm.drawText(24, 130, 'CLAIMSFLOW', P.white, 240, 3);
  bm.drawText(24, 154, 'SCAN AGENT', P.glow, 220, 3);

  // Description
  bm.drawText(24, 192, 'CONNECTS CLAIMSFLOW TO YOUR', P.offWhite, 170, 1);
  bm.drawText(24, 204, 'OFFICE SCANNER OVER LOCALHOST.', P.offWhite, 170, 1);

  // Vendor pills row
  const vendors = ['CANON', 'KODAK', 'FUJITSU', 'HP', 'EPSON'];
  let vx = 24;
  vendors.forEach(v => {
    const pw = v.length * 6 + 8;
    bm.rect(vx, 224, pw, 13, P.bgCard, 160);
    bm.strokeRect(vx, 224, pw, 13, P.accentLt, 100);
    bm.drawText(vx + 4, 226, v, P.glow, 200, 1);
    vx += pw + 6;
  });

  // Feature badges strip (bottom)
  const badges = [['TWAIN/ISIS', 80], ['ESCL/AIRSCAN', 96], ['WIN SERVICE', 88], ['AUTO-PDF', 72]];
  let bx = 24;
  badges.forEach(([label, bw]) => {
    bm.rect(bx, 360, bw, 16, P.accent, 40);
    bm.strokeRect(bx, 360, bw, 16, P.accentLt, 80);
    bm.drawText(bx + 4, 363, label, P.glow, 200, 1);
    bx += bw + 8;
  });

  // Copyright
  bm.drawText(24, 344, '(C) 2026 CIC INSURANCE GROUP PLC  V1.1.0', P.muted, 120, 1);

  // Bottom accent bar
  accentBar(bm, 384);
  accentBar(bm, 385);

  return bm;
}

// ── 4. App icon (.ico) ─────────────────────────────────────────────────────────
// Draws the brand tile (gradient rounded square + CF monogram) at a given size.
function makeIconBitmap(size) {
  const bm = new Bitmap(size, size);
  // Diagonal accent gradient fill
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      const c = lerpColor(P.accent, P.teal, t);
      bm.setPixel(x, y, c.r, c.g, c.b);
    }
  // Soft top glow + inner darken for depth
  bm.glow(size * 0.3, size * 0.25, size * 0.6, P.glow, 70);
  bm.gradV(0, Math.round(size * 0.55), size, size, hex('#0A1628'), hex('#050B1A'));
  // CF monogram, scaled to icon size
  const scale = Math.max(1, Math.round(size / 18));
  const cfW = (5 * 2 + 1) * scale;
  bm.drawText(Math.round(size / 2 - cfW / 2), Math.round(size / 2 - 3.5 * scale), 'CF', P.white, 255, scale);
  return bm;
}

// Build a multi-resolution .ico from BGRA DIB entries (32-bit, opaque).
function toIco(sizes) {
  const bitmaps = sizes.map((s) => ({ s, bm: makeIconBitmap(s) }));
  const images = bitmaps.map(({ s, bm }) => {
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(s, 4);
    header.writeInt32LE(s * 2, 8);   // height ×2: XOR bitmap + AND mask
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    header.writeUInt32LE(0, 16);     // BI_RGB
    // XOR bitmap: 32-bit BGRA, bottom-up
    const xor = Buffer.alloc(s * s * 4);
    let o = 0;
    for (let y = s - 1; y >= 0; y--)
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        xor[o++] = bm.data[i + 2];   // B
        xor[o++] = bm.data[i + 1];   // G
        xor[o++] = bm.data[i + 0];   // R
        xor[o++] = 255;              // A (opaque)
      }
    // AND mask: 1bpp, rows padded to 4 bytes, all zero (alpha drives transparency)
    const andRow = Math.ceil(s / 32) * 4;
    const andMask = Buffer.alloc(andRow * s, 0);
    return Buffer.concat([header, xor, andMask]);
  });

  const count = images.length;
  const dir = Buffer.alloc(6 + 16 * count);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);           // type: icon
  dir.writeUInt16LE(count, 4);
  let offset = 6 + 16 * count;
  bitmaps.forEach(({ s }, idx) => {
    const e = 6 + 16 * idx;
    dir.writeUInt8(s >= 256 ? 0 : s, e);
    dir.writeUInt8(s >= 256 ? 0 : s, e + 1);
    dir.writeUInt8(0, e + 2);
    dir.writeUInt8(0, e + 3);
    dir.writeUInt16LE(1, e + 4);     // planes
    dir.writeUInt16LE(32, e + 6);    // bit count
    dir.writeUInt32LE(images[idx].length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += images[idx].length;
  });
  return Buffer.concat([dir, ...images]);
}

// ── Write files ───────────────────────────────────────────────────────────────
function save(bm, name) {
  const bmpPath = path.join(ASSETS, `${name}.bmp`);
  fs.writeFileSync(bmpPath, bm.toBmp());
  const kb = Math.round(fs.statSync(bmpPath).size / 1024);
  console.log(`  ✓ ${name}.bmp  (${bm.w}×${bm.h}, ${kb} KB)`);
}

console.log('\nGenerating installer assets…\n');
save(makeSidebar(), 'wizard-sidebar');
save(makeHeader(),  'wizard-header');
save(makeSplash(),  'setup-splash');

const icoPath = path.join(ASSETS, 'icon.ico');
fs.writeFileSync(icoPath, toIco([256, 48, 32, 16]));
console.log(`  ✓ icon.ico  (256/48/32/16, ${Math.round(fs.statSync(icoPath).size / 1024)} KB)`);

console.log(`\nAll assets written to: ${ASSETS}\n`);
