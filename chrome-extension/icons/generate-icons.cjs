/**
 * generate-icons.js
 * Generates PNG icon files (16x16, 48x48, 128x128) for the ifin Platform Browser extension.
 * Uses pure Node.js Buffer manipulation to create valid PNG files with a modern geometric "M" logo.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------------------------------------------ */
/*  Minimal PNG encoder (no dependencies)                              */
/* ------------------------------------------------------------------ */

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, typeB, data, crcB]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT – raw image data with filter byte 0 per row
  const rowLen = width * 4 + 1;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // filter none
    rgba.copy(raw, y * rowLen + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', iend),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Icon drawing                                                       */
/* ------------------------------------------------------------------ */

function hexToRGBA(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, 255];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
    255,
  ];
}

function setPixel(buf, w, x, y, color) {
  const idx = (y * w + x) * 4;
  buf[idx] = color[0];
  buf[idx + 1] = color[1];
  buf[idx + 2] = color[2];
  buf[idx + 3] = color[3];
}

function blendPixel(buf, w, x, y, color, alpha) {
  const idx = (y * w + x) * 4;
  const a = alpha / 255;
  buf[idx] = Math.round(buf[idx] * (1 - a) + color[0] * a);
  buf[idx + 1] = Math.round(buf[idx + 1] * (1 - a) + color[1] * a);
  buf[idx + 2] = Math.round(buf[idx + 2] * (1 - a) + color[2] * a);
  buf[idx + 3] = 255;
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = hexToRGBA('#0d1117');
  const blue = hexToRGBA('#58a6ff');
  const cyan = hexToRGBA('#39d2c0');
  const purple = hexToRGBA('#bc8cff');

  // Fill background
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPixel(buf, size, x, y, bg);
    }
  }

  const s = size; // shorthand
  const cx = s / 2;
  const cy = s / 2;
  const margin = s * 0.12;

  // Draw rounded rectangle border with subtle gradient
  const r = s * 0.2; // corner radius
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      // Check if inside rounded rect border
      const inset = margin * 0.5;
      const bx = Math.max(inset + r, Math.min(x, s - inset - r));
      const by = Math.max(inset + r, Math.min(y, s - inset - r));
      const d = dist(x, y, bx, by);
      if (d <= r && d >= r - Math.max(1, s * 0.025)) {
        const t = y / s;
        const borderColor = lerpColor(blue, cyan, t);
        const alpha = Math.max(0, Math.min(255, (r - d) * 255 / Math.max(1, s * 0.025)));
        blendPixel(buf, s, x, y, borderColor, alpha);
      }
    }
  }

  // Draw "M" letterform – geometric, modern style
  const letterMargin = s * 0.22;
  const left = letterMargin;
  const right = s - letterMargin;
  const top = s * 0.25;
  const bottom = s * 0.75;
  const strokeW = Math.max(1, s * 0.09);
  const midX = cx;
  const midY = s * 0.48;

  // Helper: draw thick line
  function drawLine(x1, y1, x2, y2, thickness, color1, color2) {
    const len = dist(x1, y1, x2, y2);
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = lerp(x1, x2, t);
      const py = lerp(y1, y2, t);
      const col = lerpColor(color1, color2 || color1, t);
      const half = thickness / 2;
      for (let dy = -Math.ceil(half); dy <= Math.ceil(half); dy++) {
        for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
          const ix = Math.round(px + dx);
          const iy = Math.round(py + dy);
          if (ix >= 0 && ix < s && iy >= 0 && iy < s) {
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d <= half) {
              const alpha = d > half - 1 ? Math.round((half - d) * 255) : 255;
              blendPixel(buf, s, ix, iy, col, alpha);
            }
          }
        }
      }
    }
  }

  // M: left vertical stroke
  drawLine(left, bottom, left, top, strokeW, blue, cyan);
  // M: left diagonal to center
  drawLine(left, top, midX, midY, strokeW, cyan, purple);
  // M: right diagonal from center
  drawLine(midX, midY, right, top, strokeW, purple, blue);
  // M: right vertical stroke
  drawLine(right, top, right, bottom, strokeW, blue, cyan);

  // Add a subtle glow dot at center junction
  const glowR = s * 0.06;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = dist(x, y, midX, midY);
      if (d < glowR * 3) {
        const alpha = Math.max(0, Math.round(80 * Math.exp(-d * d / (glowR * glowR * 2))));
        blendPixel(buf, s, x, y, [255, 255, 255], alpha);
      }
    }
  }

  return buf;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

const outDir = __dirname;

for (const size of [16, 48, 128]) {
  const pixels = drawIcon(size);
  const png = encodePNG(size, size, pixels);
  const filePath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Created ${filePath} (${png.length} bytes)`);
}

console.log('Icon generation complete.');
