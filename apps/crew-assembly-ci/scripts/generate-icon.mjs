#!/usr/bin/env node
/**
 * Generates `assets/icon.png`: a 256x256 RGBA PNG of two meshing brass gears with a hex bolt, on a
 * dark navy rounded square. Pure Node (`node:zlib` plus a hand-written PNG chunk writer), no
 * image downloads and no dependencies. The output is deterministic.
 *
 *   node scripts/generate-icon.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 256;
const SAMPLES = 4; // 4 x 4 samples per pixel for smooth edges
const outPath = fileURLToPath(new URL("../assets/icon.png", import.meta.url));

// --- Geometry -------------------------------------------------------------------------------
const TOOTH_COUNT_BIG = 12;
const TOOTH_COUNT_SMALL = 8;
const PITCH_BIG = 60;
const PITCH_SMALL = (PITCH_BIG * TOOTH_COUNT_SMALL) / TOOTH_COUNT_BIG; // same tooth pitch, so the gears mesh
const TOOTH_HEIGHT = 13;
const MESH_ANGLE = -Math.PI / 4; // direction from the big gear to the small gear
const BIG = { cx: 100, cy: 150, pitch: PITCH_BIG, teeth: TOOTH_COUNT_BIG, rot: MESH_ANGLE + Math.PI / TOOTH_COUNT_BIG };
const SMALL = {
  cx: BIG.cx + (PITCH_BIG + PITCH_SMALL) * Math.cos(MESH_ANGLE),
  cy: BIG.cy + (PITCH_BIG + PITCH_SMALL) * Math.sin(MESH_ANGLE),
  pitch: PITCH_SMALL,
  teeth: TOOTH_COUNT_SMALL,
  rot: MESH_ANGLE + Math.PI,
};

/** Outer radius of a gear at angle `theta`: a trapezoidal tooth profile around the root circle. */
function gearRadius(gear, theta) {
  const root = gear.pitch - TOOTH_HEIGHT / 2;
  const wave = Math.cos(gear.teeth * (theta - gear.rot));
  const tooth = Math.min(1, Math.max(0, (wave + 0.2) / 0.55));
  return root + TOOTH_HEIGHT * tooth;
}

function hexInside(dx, dy, circumradius) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const inradius = circumradius * Math.cos(Math.PI / 6);
  return ay <= inradius && ax * Math.cos(Math.PI / 6) + ay * 0.5 <= inradius;
}

function roundedSquareInside(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), SIZE - radius);
  const cy = Math.min(Math.max(y, radius), SIZE - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

// --- Colour ---------------------------------------------------------------------------------
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const NAVY_TOP = [22, 34, 72];
const NAVY_BOTTOM = [8, 13, 33];
const BRASS_DARK = [128, 88, 24];
const BRASS_MID = [196, 146, 52];
const BRASS_LIGHT = [244, 208, 118];
const SHADOW = [4, 7, 18];

function brass(x, y, r, root) {
  const light = Math.min(1, Math.max(0, 1 - (x + y) / (SIZE * 1.25)));
  let color = light < 0.5 ? mix(BRASS_DARK, BRASS_MID, light * 2) : mix(BRASS_MID, BRASS_LIGHT, (light - 0.5) * 2);
  if (r > root - 9 && r < root - 6.5) {
    color = mix(color, BRASS_DARK, 0.55); // engraved ring
  }
  if (r > root - 3 && r < root) {
    color = mix(color, BRASS_LIGHT, 0.25); // bevel just inside the teeth
  }
  return color;
}

/** Colour and coverage (alpha 0 or 1) of one sample point. */
function shade(x, y) {
  if (!roundedSquareInside(x, y, 52)) {
    return null;
  }
  let color = mix(NAVY_TOP, NAVY_BOTTOM, y / SIZE);
  // Brass inset border.
  if (roundedInset(x, y, 8, 44) && !roundedInset(x, y, 11.5, 40.5)) {
    color = mix(BRASS_DARK, BRASS_MID, 0.6);
  }
  // Drop shadow of the gears: the gear silhouette moved by (5, 6).
  if (inGears(x - 5, y - 6)) {
    color = mix(color, SHADOW, 0.7);
  }

  const smallDx = x - SMALL.cx;
  const smallDy = y - SMALL.cy;
  const smallR = Math.hypot(smallDx, smallDy);
  const bigDx = x - BIG.cx;
  const bigDy = y - BIG.cy;
  const bigR = Math.hypot(bigDx, bigDy);

  const inSmall = smallR <= gearRadius(SMALL, Math.atan2(smallDy, smallDx)) && smallR > 11;
  const inBig = bigR <= gearRadius(BIG, Math.atan2(bigDy, bigDx)) && bigR > 31;
  if (inSmall) {
    color = brass(x, y, smallR, SMALL.pitch - TOOTH_HEIGHT / 2);
  }
  if (inBig) {
    color = brass(x, y, bigR, BIG.pitch - TOOTH_HEIGHT / 2);
  }
  // Hex bolt head in the big gear, with a recessed socket.
  if (bigR <= 31 && bigR > 23.5) {
    color = mix(NAVY_BOTTOM, NAVY_TOP, 0.3);
  }
  if (hexInside(bigDx, bigDy, 25)) {
    color = mix(BRASS_MID, BRASS_LIGHT, Math.min(1, Math.max(0, 0.5 - bigDy / 50 - bigDx / 90)));
    if (bigR < 10) {
      color = mix(BRASS_DARK, SHADOW, 0.6);
    }
  }
  // Axle pin of the small gear.
  if (smallR <= 11 && smallR > 5.5) {
    color = mix(NAVY_BOTTOM, NAVY_TOP, 0.3);
  }
  if (smallR <= 5.5) {
    color = mix(BRASS_MID, BRASS_LIGHT, 0.5);
  }
  return color;
}

function roundedInset(x, y, inset, radius) {
  const lo = inset + radius;
  const hi = SIZE - inset - radius;
  const cx = Math.min(Math.max(x, lo), hi);
  const cy = Math.min(Math.max(y, lo), hi);
  return x >= inset && x <= SIZE - inset && y >= inset && y <= SIZE - inset && (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function inGears(x, y) {
  const bigDx = x - BIG.cx;
  const bigDy = y - BIG.cy;
  const smallDx = x - SMALL.cx;
  const smallDy = y - SMALL.cy;
  return (
    Math.hypot(bigDx, bigDy) <= gearRadius(BIG, Math.atan2(bigDy, bigDx)) ||
    Math.hypot(smallDx, smallDy) <= gearRadius(SMALL, Math.atan2(smallDy, smallDx))
  );
}

// --- Rasterise ------------------------------------------------------------------------------
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE); // one filter byte (0 = None) per scanline
for (let py = 0; py < SIZE; py += 1) {
  const rowStart = py * (SIZE * 4 + 1);
  raw[rowStart] = 0;
  for (let px = 0; px < SIZE; px += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let covered = 0;
    for (let sy = 0; sy < SAMPLES; sy += 1) {
      for (let sx = 0; sx < SAMPLES; sx += 1) {
        const color = shade(px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES);
        if (color !== null) {
          r += color[0];
          g += color[1];
          b += color[2];
          covered += 1;
        }
      }
    }
    const offset = rowStart + 1 + px * 4;
    if (covered > 0) {
      raw[offset] = Math.round(r / covered);
      raw[offset + 1] = Math.round(g / covered);
      raw[offset + 2] = Math.round(b / covered);
      raw[offset + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    }
  }
}

// --- PNG encoding ---------------------------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // colour type: RGBA
header[10] = 0; // compression
header[11] = 0; // filter
header[12] = 0; // no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
process.stdout.write(`wrote ${outPath} (${png.length} bytes)\n`);
