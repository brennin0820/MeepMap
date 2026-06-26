'use strict';

/**
 * Generates MeepMap app icons for electron-builder from the SVG source palette.
 * Run: node scripts/generate-app-icons.js
 * Output: build/icon.png, build/icon.ico, build/icons/*.png
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const ICONS_DIR = path.join(BUILD_DIR, 'icons');

const BG = [0x14, 0x17, 0x21];
const GEM_TOP = [0xf5, 0x68, 0x87];
const GEM_BOTTOM = [0xd6, 0x47, 0x85];
const HIGHLIGHT = [0xff, 0xff, 0xff, 0x48];

const SIZES = [16, 32, 48, 64, 128, 256, 512];

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function mixColor(top, bottom, t) {
  return [
    lerp(top[0], bottom[0], t),
    lerp(top[1], bottom[1], t),
    lerp(top[2], bottom[2], t),
  ];
}

function inDiamond(x, y, cx, cy, radius) {
  const dx = Math.abs(x - cx) / radius;
  const dy = Math.abs(y - cy) / radius;
  return dx + dy <= 1;
}

function inInnerDiamond(x, y, cx, cy, radius) {
  const dx = Math.abs(x - cx) / (radius * 0.72);
  const dy = Math.abs(y - cy) / (radius * 0.72);
  return dx + dy <= 1;
}

function roundedRectAlpha(x, y, size, radius) {
  const margin = size * 0.047;
  const inner = size - margin * 2;
  const r = inner * (radius / 512);
  const left = margin;
  const top = margin;
  const right = margin + inner;
  const bottom = margin + inner;

  if (x < left || x >= right || y < top || y >= bottom) {
    return 0;
  }

  function corner(cx, cy) {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  }

  const inHorizontal = x >= left + r && x < right - r;
  const inVertical = y >= top + r && y < bottom - r;
  if (inHorizontal || inVertical) {
    return 1;
  }

  return (
    corner(left + r, top + r)
    || corner(right - r, top + r)
    || corner(left + r, bottom - r)
    || corner(right - r, bottom - r)
  ) ? 1 : 0;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const gemRadius = size * 0.31;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const mask = roundedRectAlpha(x + 0.5, y + 0.5, size, 96);
      if (!mask) {
        rgba[idx + 3] = 0;
        continue;
      }

      rgba[idx] = BG[0];
      rgba[idx + 1] = BG[1];
      rgba[idx + 2] = BG[2];
      rgba[idx + 3] = 255;

      if (inDiamond(x + 0.5, y + 0.5, cx, cy, gemRadius)) {
        const t = (y + 0.5) / size;
        const [r, g, b] = mixColor(GEM_TOP, GEM_BOTTOM, t);
        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
      }

      if (inInnerDiamond(x + 0.5, y + 0.5, cx, cy, gemRadius)) {
        rgba[idx] = lerp(rgba[idx], HIGHLIGHT[0], HIGHLIGHT[3] / 255);
        rgba[idx + 1] = lerp(rgba[idx + 1], HIGHLIGHT[1], HIGHLIGHT[3] / 255);
        rgba[idx + 2] = lerp(rgba[idx + 2], HIGHLIGHT[2], HIGHLIGHT[3] / 255);
      }

      const dotRadius = Math.max(1, size * 0.012);
      const dotDx = x + 0.5 - cx;
      const dotDy = y + 0.5 - cy;
      if (dotDx * dotDx + dotDy * dotDy <= dotRadius * dotRadius) {
        rgba[idx] = 255;
        rgba[idx + 1] = 255;
        rgba[idx + 2] = 255;
      }
    }
  }

  return rgba;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(images) {
  const count = images.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const entries = [];
  const dataChunks = [];

  for (const { size, png } of images) {
    entries.push({
      size,
      offset,
      png,
    });
    offset += png.length;
  }

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let entryOffset = 6;
  for (const entry of entries) {
    const dim = entry.size >= 256 ? 0 : entry.size;
    header[entryOffset] = dim;
    header[entryOffset + 1] = dim;
    header.writeUInt16LE(1, entryOffset + 2);
    header.writeUInt16LE(32, entryOffset + 4);
    header.writeUInt32LE(entry.png.length, entryOffset + 8);
    header.writeUInt32LE(entry.offset, entryOffset + 12);
    entryOffset += 16;
    dataChunks.push(entry.png);
  }

  return Buffer.concat([header, ...dataChunks]);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  ensureDir(BUILD_DIR);
  ensureDir(ICONS_DIR);

  const pngBySize = new Map();
  for (const size of SIZES) {
    const png = encodePng(size, renderIcon(size));
    pngBySize.set(size, png);
    fs.writeFileSync(path.join(ICONS_DIR, `${size}x${size}.png`), png);
  }

  const icon512 = pngBySize.get(512);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), icon512);

  const icoSizes = [16, 32, 48, 64, 128, 256];
  const ico = encodeIco(
    icoSizes.map((size) => ({ size, png: pngBySize.get(size) })),
  );
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), ico);

  console.log('Generated MeepMap icons:');
  console.log('  build/icon.png (512x512)');
  console.log('  build/icon.ico');
  console.log(`  build/icons/{${SIZES.join(',')}}x*.png`);
}

main();
