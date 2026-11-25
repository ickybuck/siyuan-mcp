/**
 * Icons for the task page: a white tick in a green rounded square.
 *
 * SVG for modern browsers; PNG (and an ICO wrapping a PNG) for bookmarks and the iOS home screen.
 * PNG 由纯 JS 光栅化生成（圆角矩形 + 两段粗线），启动时算一次，不依赖任何图像库。
 */
import { deflateSync } from 'node:zlib';

const GREEN = [0x2f, 0x6f, 0x5e];

export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect x="1" y="1" width="30" height="30" rx="7" fill="#2f6f5e"/>' +
  '<path d="M8.5 16.5l5 5 10-11" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

/** Distance from point p to segment ab. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Coverage (0..1) of one sample point, in the SVG's 32-unit space. */
function sample(x: number, y: number, full: boolean): { bg: number; tick: number } {
  // full: fill the whole square (apple-touch icons are masked by iOS), else the rounded rect
  let bg = 1;
  if (!full) {
    const r = 7;
    const cx = Math.min(Math.max(x, 1 + r), 31 - r);
    const cy = Math.min(Math.max(y, 1 + r), 31 - r);
    bg = x < 1 || x > 31 || y < 1 || y > 31 || Math.hypot(x - cx, y - cy) > r ? 0 : 1;
  }
  const d = Math.min(segDist(x, y, 8.5, 16.5, 13.5, 21.5), segDist(x, y, 13.5, 21.5, 23.5, 10.5));
  return { bg, tick: d <= 2 ? 1 : 0 };
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Render the icon as an RGBA PNG of the given size, 4x4 supersampled. */
export function renderPng(size: number, full = false): Buffer {
  const S = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let tick = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = ((px + (sx + 0.5) / S) * 32) / size;
          const y = ((py + (sy + 0.5) / S) * 32) / size;
          const s = sample(x, y, full);
          bg += s.bg;
          tick += s.tick * s.bg;
        }
      }
      const a = bg / (S * S);
      const w = bg ? tick / bg : 0; // share of white within the covered area
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(GREEN[i] * (1 - w) + 255 * w);
      raw[o + 3] = Math.round(255 * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An ICO file holding PNG images (valid since Windows Vista; every current browser reads it). */
function icoFromPngs(pngs: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((p, i) => {
    const o = i * 16;
    dir[o] = p.size >= 256 ? 0 : p.size;
    dir[o + 1] = p.size >= 256 ? 0 : p.size;
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(p.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += p.data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

export const FAVICON_ICO = icoFromPngs([16, 32, 48].map((size) => ({ size, data: renderPng(size) })));
export const APPLE_TOUCH_PNG = renderPng(180, true);
