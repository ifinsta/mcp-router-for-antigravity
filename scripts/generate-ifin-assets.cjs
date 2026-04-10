'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const repoRoot = path.resolve(__dirname, '..');
const brandDir = path.join(repoRoot, 'shared', 'brand');
const extensionAssetsDir = path.join(repoRoot, 'chrome-extension', 'assets');
const extensionIconsDir = path.join(repoRoot, 'chrome-extension', 'icons');
const rendererAssetsDir = path.join(repoRoot, 'electron', 'renderer', 'assets');
const extensionMediaDir = path.join(repoRoot, 'extension', 'media');
const electronDir = path.join(repoRoot, 'electron');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(source, destination) {
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let j = 0; j < 8; j += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([len, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowLength] = 0;
    rgba.copy(raw, y * rowLength + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function rgba(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

function setPixel(buffer, width, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= buffer.length / (width * 4)) {
    return;
  }
  const index = (y * width + x) * 4;
  buffer[index] = color[0];
  buffer[index + 1] = color[1];
  buffer[index + 2] = color[2];
  buffer[index + 3] = color[3];
}

function blendPixel(buffer, width, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= width || y >= buffer.length / (width * 4)) {
    return;
  }
  const index = (y * width + x) * 4;
  const sourceAlpha = alpha / 255;
  buffer[index] = Math.round(buffer[index] * (1 - sourceAlpha) + color[0] * sourceAlpha);
  buffer[index + 1] = Math.round(buffer[index + 1] * (1 - sourceAlpha) + color[1] * sourceAlpha);
  buffer[index + 2] = Math.round(buffer[index + 2] * (1 - sourceAlpha) + color[2] * sourceAlpha);
  buffer[index + 3] = 255;
}

function fillRect(buffer, width, x, y, rectWidth, rectHeight, color) {
  for (let offsetY = 0; offsetY < rectHeight; offsetY += 1) {
    for (let offsetX = 0; offsetX < rectWidth; offsetX += 1) {
      setPixel(buffer, width, x + offsetX, y + offsetY, color);
    }
  }
}

function fillRoundedRect(buffer, width, x, y, rectWidth, rectHeight, radius, color, strokeColor = null) {
  const height = buffer.length / (width * 4);
  for (let py = y; py < y + rectHeight; py += 1) {
    for (let px = x; px < x + rectWidth; px += 1) {
      if (px < 0 || py < 0 || px >= width || py >= height) {
        continue;
      }
      const innerX = Math.max(x + radius, Math.min(px, x + rectWidth - radius - 1));
      const innerY = Math.max(y + radius, Math.min(py, y + rectHeight - radius - 1));
      const distance = Math.hypot(px - innerX, py - innerY);
      if (distance <= radius) {
        if (
          strokeColor &&
          (px === x || py === y || px === x + rectWidth - 1 || py === y + rectHeight - 1 || distance >= radius - 1.25)
        ) {
          setPixel(buffer, width, px, py, strokeColor);
        } else {
          setPixel(buffer, width, px, py, color);
        }
      }
    }
  }
}

function drawLine(buffer, width, x1, y1, x2, y2, thickness, color) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  const radius = thickness / 2;
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const x = Math.round(x1 + (x2 - x1) * t);
    const y = Math.round(y1 + (y2 - y1) * t);
    for (let py = Math.floor(y - radius); py <= Math.ceil(y + radius); py += 1) {
      for (let px = Math.floor(x - radius); px <= Math.ceil(x + radius); px += 1) {
        const distance = Math.hypot(px - x, py - y);
        if (distance <= radius) {
          blendPixel(buffer, width, px, py, color, 255);
        }
      }
    }
  }
}

function drawIfinMark(size) {
  const buffer = Buffer.alloc(size * size * 4);
  const background = rgba('#141516');
  const border = rgba('#3B434B');
  const light = rgba('#EDF1F5');
  const blue = rgba('#0F6CBD');

  fillRoundedRect(buffer, size, 0, 0, size, size, Math.round(size * 0.22), background);
  fillRoundedRect(
    buffer,
    size,
    Math.round(size * 0.04),
    Math.round(size * 0.04),
    Math.round(size * 0.92),
    Math.round(size * 0.92),
    Math.round(size * 0.2),
    background,
    border
  );

  fillRoundedRect(buffer, size, Math.round(size * 0.25), Math.round(size * 0.24), Math.round(size * 0.12), Math.round(size * 0.52), Math.round(size * 0.08), light);
  fillRoundedRect(buffer, size, Math.round(size * 0.46), Math.round(size * 0.24), Math.round(size * 0.12), Math.round(size * 0.32), Math.round(size * 0.08), blue);
  drawLine(
    buffer,
    size,
    Math.round(size * 0.64),
    Math.round(size * 0.76),
    Math.round(size * 0.64),
    Math.round(size * 0.34),
    Math.max(2, Math.round(size * 0.1)),
    light
  );
  drawLine(
    buffer,
    size,
    Math.round(size * 0.64),
    Math.round(size * 0.34),
    Math.round(size * 0.78),
    Math.round(size * 0.34),
    Math.max(2, Math.round(size * 0.1)),
    light
  );

  return buffer;
}

function encodeIcoFromPng(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const directory = Buffer.alloc(16);
  directory[0] = 0;
  directory[1] = 0;
  directory[2] = 0;
  directory[3] = 0;
  directory.writeUInt16LE(1, 4);
  directory.writeUInt16LE(32, 6);
  directory.writeUInt32LE(pngBuffer.length, 8);
  directory.writeUInt32LE(header.length + directory.length, 12);

  return Buffer.concat([header, directory, pngBuffer]);
}

function writeGeneratedIcons() {
  ensureDir(extensionIconsDir);
  ensureDir(electronDir);

  for (const size of [16, 48, 128]) {
    const png = encodePng(size, size, drawIfinMark(size));
    fs.writeFileSync(path.join(extensionIconsDir, `icon${size}.png`), png);
  }

  const electronPng = encodePng(256, 256, drawIfinMark(256));
  fs.writeFileSync(path.join(electronDir, 'icon.png'), electronPng);
  fs.writeFileSync(path.join(electronDir, 'icon.ico'), encodeIcoFromPng(electronPng));
}

function copyBrandAssets() {
  ensureDir(extensionAssetsDir);
  ensureDir(rendererAssetsDir);
  ensureDir(extensionMediaDir);

  const assets = [
    'ifin-logo-dark.svg',
    'ifin-logo-light.svg',
    'ifin-mark-dark.svg',
    'ifin-mark-light.svg',
  ];

  for (const asset of assets) {
    const source = path.join(brandDir, asset);
    copyFile(source, path.join(extensionAssetsDir, asset));
    copyFile(source, path.join(rendererAssetsDir, asset));
    copyFile(source, path.join(extensionMediaDir, asset));
  }

  copyFile(path.join(brandDir, 'variables.css'), path.join(repoRoot, 'chrome-extension', 'variables.css'));
}

function main() {
  copyBrandAssets();
  writeGeneratedIcons();
  console.log('ifin brand assets generated.');
}

main();
