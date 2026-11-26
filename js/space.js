// APOGEE retro pixel-art flight renderer.
// The whole scene is drawn on a tiny canvas (about 200 x 350 pixels) with single-pixel marks, a fixed colour palette and
// ordered (Bayer) dithering, then shown with nearest-neighbour scaling, so every pixel is a crisp square.
// Nothing is downloaded: sprites are baked from code. The player's altitude (flight units) moves a camera up through
// the sky, the stratosphere, low orbit, the solar system, interstellar space and out to the galaxies.
import { CONFIG, ZONES } from './config.js?v=space-20261126';
import { predatorGulp, rareSparkle } from './audio.js?v=space-20261126';

const canvas = document.getElementById('scene');
const ctx = canvas?.getContext('2d', { alpha: false });

let getDepth = () => 0, isStill = () => false, getHaptics = () => false, getColorSafe = () => false;
let LW = 200, LH = 340, scale = 3, U = 200;        // logical size, screen pixels per logical pixel, size unit for objects
let visualDepth = 0, visualStage = 0, sinkSmooth = 0, prevStage = 0;
let previousTime = 0, frozenTime = 0, frameStarted = false, rafHandle = 0, lastDraw = 0;
let eventScene = null, focusTimer = 0, zoneIndex = 0, zoneWipe = null, bannerEl = null;
let fpsCap = 60, shipY = 0;

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const MAXD = CONFIG.MAX_DEPTH_VISUAL;

/* ---------------------------------------------------------------- small helpers */
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];
const c32 = hex => { const n = parseInt(hex.slice(1), 16); return (((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0); };
function hash2(x, y, s) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function noise(x, y, s = 1) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return mix(mix(hash2(xi, yi, s), hash2(xi + 1, yi, s), u), mix(hash2(xi, yi + 1, s), hash2(xi + 1, yi + 1, s), u), v);
}
const fbm = (x, y, s) => noise(x, y, s) * 0.55 + noise(x * 2.1, y * 2.1, s + 7) * 0.3 + noise(x * 4.3, y * 4.3, s + 13) * 0.15;

let lastFill = '';
function col(c) { if (c !== lastFill) { ctx.fillStyle = c; lastFill = c; } }
function px(x, y, c) { col(c); ctx.fillRect(x | 0, y | 0, 1, 1); }
function rect(x, y, w, h, c) { col(c); ctx.fillRect(x | 0, y | 0, w, h); }
function line(x0, y0, x1, y1, colorAt) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  const n = Math.max(dx, -dy) + 1; let err = dx + dy, i = 0;
  for (;;) {
    const c = colorAt(i, n); if (c) px(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } i++;
  }
}
/** Dotted ring (corona, shock waves): `density` 0..1 of the circle's pixels are drawn, in a dither pattern. */
function ring(cx, cy, r, c, density, step = 1) {
  const n = Math.max(8, Math.round(r * TAU / step));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    if (bayer(x, y) < density) px(x, y, c);
  }
}
function bake(w, h, fn) {
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
  const g = c.getContext('2d'), img = g.createImageData(c.width, c.height), d = new Uint32Array(img.data.buffer);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) d[y * c.width + x] = fn(x, y) || 0;
  g.putImageData(img, 0, 0); return c;
}
function spriteFromRows(rows, pal) {
  const w = rows[0].length, h = rows.length, map = {}; for (const k in pal) map[k] = c32(pal[k]);
  return bake(w, h, (x, y) => map[rows[y][x]] || 0);
}
const blit = (img, x, y) => ctx.drawImage(img, Math.round(x), Math.round(y));
const blitScaled = (img, x, y, k) => ctx.drawImage(img, Math.round(x), Math.round(y), Math.round(img.width * k), Math.round(img.height * k));

/* ---------------------------------------------------------------- palette */
// One long ramp from bright day sky to black space to a purple deep-space glow. The sky is dithered along it.
const SKY_RAMP = ['#bfe9ff', '#8fd0ff', '#5db4f5', '#3b92e6', '#2a6fcc', '#2352a8', '#1b3a82', '#142a62', '#0d1c45', '#081230', '#050a22', '#03061a',
  '#0a0724', '#150a33', '#220e45', '#33135a', '#4a1a6e'].map(c32);
// [stage, top ramp position, bottom ramp position]
const SKY_KEYS = [[0, 3, 0.2], [0.05, 4.2, 1.6], [0.15, 8, 5], [0.30, 11, 8.2], [0.45, 11, 10], [0.60, 11.2, 10.6], [0.70, 11.6, 12.6], [0.80, 12.2, 14], [1, 12.8, 15.6]];
function skyAt(s) {
  for (let i = 1; i < SKY_KEYS.length; i++) if (s <= SKY_KEYS[i][0]) {
    const a = SKY_KEYS[i - 1], b = SKY_KEYS[i], t = (s - a[0]) / (b[0] - a[0]); return [mix(a[1], b[1], t), mix(a[2], b[2], t)];
  }
  const k = SKY_KEYS[SKY_KEYS.length - 1]; return [k[1], k[2]];
}
let skyImage = null, skyKey = -1;
function paintSky(s) {
  const key = Math.round(s * 160) * 10000 + LW * 7 + LH;
  if (key !== skyKey) {
    const [top, bot] = skyAt(s);
    skyImage = bake(LW, LH, (x, y) => {
      const u = mix(top, bot, y / LH), i = Math.floor(u), f = u - i, j = f > bayer(x, y) ? i + 1 : i;
      return SKY_RAMP[clamp(j, 0, SKY_RAMP.length - 1)];
    });
    skyKey = key;
  }
  ctx.drawImage(skyImage, 0, 0);
}

/* ---------------------------------------------------------------- baked sprites */
const cache = new Map();
const cached = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
const ramp = arr => arr.map(c32);
const RAMPS = {
  moon: ramp(['#2b2b38', '#4b4b5c', '#7a7a8c', '#a9a9b8', '#d8d8e4']), moonDark: ramp(['#22222d', '#3c3c4a', '#62627a', '#8d8da0', '#b8b8c8']),
  mars: ramp(['#3a1410', '#6b2418', '#a63a22', '#d2582c', '#f08a4b']), marsDark: ramp(['#2a0f0e', '#4d1c14', '#7c2c1b', '#a64425', '#c96a3a']),
  ice: ramp(['#6a7a99', '#9fb0cc', '#d6e0f0', '#f2f6ff', '#ffffff']),
  venus: ramp(['#5a3e1a', '#8a6428', '#c0963e', '#e6c566', '#fff0a8']),
  jupA: ramp(['#5e4a38', '#8c7456', '#bda17a', '#e0c9a0', '#f6e8c8']), jupB: ramp(['#3e2a1e', '#6a452c', '#9a6a40', '#c28c58', '#dca878']),
  jupSpot: ramp(['#4a1410', '#7a2218', '#b33a26', '#d9603c', '#f08a5e']),
  saturn: ramp(['#4d4028', '#7a6a3e', '#a8935a', '#d4bd7c', '#f2e3a6']),
  neptune: ramp(['#0c1a4d', '#17307f', '#2750bf', '#4b7ff0', '#8ab4ff']),
  sun: ramp(['#ff6a14', '#ff9a1a', '#ffc72e', '#ffe873', '#ffffff']),
  rock: ramp(['#2a2420', '#4a3f36', '#6d5f52', '#968676']),
};
/** A shaded pixel sphere. `pick(nx, ny, nz)` chooses which ramp a pixel uses (bands, craters, caps). */
function bakeSphere(R, pick, light = [-0.55, -0.6, 0.58]) {
  const size = R * 2 + 2, len = Math.hypot(...light), [lx, ly, lz] = light.map(v => v / len);
  return bake(size, size, (x, y) => {
    const nx = (x - R - 0.5) / R, ny = (y - R - 0.5) / R, r2 = nx * nx + ny * ny;
    if (r2 > 1) return 0;
    const nz = Math.sqrt(1 - r2), L = Math.max(0, nx * lx + ny * ly + nz * lz), rp = pick(nx, ny, nz), n = rp.length;
    const lvl = L * (n - 1) + (bayer(x, y) - 0.5) * 0.95;
    return rp[clamp(Math.round(lvl), 0, n - 1)];
  });
}
function craterField(seed, count) {
  const r = rng(seed), list = [];
  for (let i = 0; i < count; i++) list.push([r() * 1.7 - 0.85, r() * 1.7 - 0.85, 0.07 + r() * 0.16]);
  return list;
}
const planetSprite = id => cached('planet-' + id + '-' + U, () => {
  const R = r => Math.max(5, Math.round(U * r));
  if (id === 'moon') { const cr = craterField(3, 15); return bakeSphere(R(0.11), (x, y) => cr.some(c => Math.hypot(x - c[0], y - c[1]) < c[2]) || noise(x * 3, y * 3, 5) > 0.72 ? RAMPS.moonDark : RAMPS.moon); }
  if (id === 'mars') return bakeSphere(R(0.075), (x, y) => y < -0.82 + noise(x * 5, 2, 3) * 0.12 ? RAMPS.ice : fbm(x * 2.6 + 4, y * 2.6, 9) > 0.52 ? RAMPS.marsDark : RAMPS.mars);
  if (id === 'venus') return bakeSphere(R(0.06), (x, y) => RAMPS.venus.map((c, i) => c) && (Math.sin(y * 7 + noise(x * 3, y * 3, 2) * 4) > 0.2 ? RAMPS.venus : RAMPS.jupA));
  if (id === 'jupiter') {
    const spot = [0.28, 0.32];
    return bakeSphere(R(0.17), (x, y) => {
      if (Math.hypot((x - spot[0]) / 0.2, (y - spot[1]) / 0.11) < 1) return RAMPS.jupSpot;
      const b = Math.sin(y * 13 + noise(x * 2, y * 5, 4) * 2.4); return b > 0.25 ? RAMPS.jupB : RAMPS.jupA;
    });
  }
  if (id === 'neptune') return bakeSphere(R(0.09), (x, y) => (noise(x * 2, y * 7, 8) > 0.66 ? RAMPS.ice.slice(0, 5).map((c, i) => RAMPS.neptune[Math.min(4, i + 1)]) : RAMPS.neptune));
  if (id === 'saturn') {
    const Rr = R(0.1), size = Math.round(Rr * 4.4), cx = size / 2, cy = size / 2, tilt = 0.30, rot = -0.32, cs = Math.cos(rot), sn = Math.sin(rot);
    const ringCols = [c32('#7a6a4a'), c32('#cdb67e'), c32('#efe0aa'), c32('#a89460')];
    return bake(size, Math.round(size * 0.62), (x, y) => {
      const ox = x - cx + 0.5, oy = y - size * 0.31 + 0.5, nx = ox / Rr, ny = oy / Rr, r2 = nx * nx + ny * ny;
      const rx = (ox * cs + oy * sn) / (Rr * 2.1), ry = (-ox * sn + oy * cs) / (Rr * 2.1 * tilt), rd = Math.hypot(rx, ry);
      const inRing = rd > 0.58 && rd < 1 && !(rd > 0.8 && rd < 0.86);
      const ringFront = (-ox * sn + oy * cs) > 0;
      if (inRing && (r2 > 1 || ringFront)) return ringCols[rd < 0.7 ? 0 : rd < 0.8 ? 1 : rd < 0.92 ? 2 : 3];
      if (r2 > 1) return 0;
      const nz = Math.sqrt(1 - r2), L = Math.max(0, nx * -0.55 + ny * -0.6 + nz * 0.58), band = Math.sin(ny * 9 + noise(nx * 2, ny * 6, 3) * 1.6) > 0.1 ? 1 : 0;
      const rp = RAMPS.saturn, lvl = L * 4 + (bayer(x, y) - 0.5) * 0.95 - band * 0.6;
      return rp[clamp(Math.round(lvl), 0, 4)];
    });
  }
  return null;
});
function earthCap() {
  return cached('earth-' + LW + 'x' + LH, () => {
    const Rr = LW * 1.55, pad = 7, ocean = ramp(['#0a1f5c', '#123a96', '#1d5fd0', '#3d8bf0', '#7ec0ff']), land = ramp(['#14401f', '#1f6a2e', '#3e9a3e', '#7ec04e', '#b8d878']);
    const halo = ramp(['#2a6fd0', '#1d4fa8', '#142f78', '#0d1c45']);
    return bake(LW, LH + pad, (x, y) => {
      const dx = x + 0.5 - LW / 2, dy = y + 0.5 - pad + Rr, d = Math.hypot(dx, dy);
      if (d > Rr) { const out = d - Rr; return out < 7 && bayer(x, y) > out / 7 ? halo[Math.min(3, Math.floor(out / 2))] : 0; }
      const nx = dx / Rr, ny = dy / Rr, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)), L = clamp(nx * 0.35 - ny * -0.2 + nz * 0.75, 0, 1);
      const cl = fbm(x * 0.05, y * 0.05 + 3, 21), isCloud = cl > 0.58, isLand = fbm(x * 0.03 + 9, y * 0.03, 31) > 0.56;
      const rp = isCloud ? RAMPS.ice : isLand ? land : ocean, lvl = L * (rp.length - 1) + (bayer(x, y) - 0.5) * 0.9 + (d > Rr - 3 ? 0.9 : 0);
      return rp[clamp(Math.round(lvl), 0, rp.length - 1)];
    });
  });
}
const CLOUD_TONES = [c32('#ffffff'), c32('#dfeeff'), c32('#b4cdee'), c32('#8aaad6')];
function cloudSprite(i) {
  return cached('cloud' + i, () => {
    const r = rng(40 + i * 11), w = 40 + i * 14, h = 18 + i * 5, discs = [];
    for (let k = 0; k < 5 + i; k++) discs.push([r() * (w - 20) + 10, h * 0.55 + (r() - 0.5) * h * 0.3, 5 + r() * (6 + i * 2)]);
    return bake(w, h, (x, y) => {
      let best = 0;
      for (const d of discs) { const v = 1 - Math.hypot(x - d[0], (y - d[1]) * 1.25) / d[2]; if (v > best) best = v; }
      if (best <= 0) return 0;
      const shade = (y / h) * 1.05 + (bayer(x, y) - 0.5) * 0.4 - best * 0.35;
      return CLOUD_TONES[clamp(Math.floor(shade * 3.2), 0, 3)];
    });
  });
}
function galaxySprite(kind, frame) {
  return cached(`gal-${kind}-${frame}-${U}`, () => {
    const S = Math.max(48, Math.round(U * (kind === 'ellipse' ? 0.52 : 0.46))), tilt = kind === 'ellipse' ? 0.42 : 0.62;
    const rp = kind === 'pink' ? ramp(['#4a1a6e', '#8a2fb0', '#e060c8', '#ffc0e8', '#ffffff']) : ramp(['#2a2f8a', '#4d5fd6', '#8fb0ff', '#ffd9b0', '#ffffff']);
    const w = S * 2, h = Math.round(S * 2 * (kind === 'ellipse' ? 0.62 : 0.9)), phi = (frame / 8) * Math.PI;
    return bake(w, h, (x, y) => {
      const dx = (x - w / 2 + 0.5) / S, dy = (y - h / 2 + 0.5) / (S * tilt) * 0.62, r = Math.hypot(dx, dy);
      if (r > 1) return 0;
      const th = Math.atan2(dy, dx), arm = kind === 'ellipse' ? 0.35 : Math.pow(0.5 + 0.5 * Math.cos(2 * (th - 2.6 * Math.log(r + 0.08)) + phi * 2), 2.2);
      const core = Math.exp(-r * r * 22), inten = arm * Math.pow(1 - r, 1.15) * 1.25 + core * 1.1 + (kind === 'ellipse' ? Math.exp(-r * r * 5) * 0.5 : 0);
      if (inten < 0.08 + bayer(x, y) * 0.42) return 0;
      return rp[clamp(Math.floor(inten * 3.3 + (1 - r) * 0.7), 0, 4)];
    });
  });
}
function nebulaSprite(i) {
  return cached(`neb-${i}-${U}`, () => {
    const w = Math.round(U * 1.0), h = Math.round(U * 0.72), seed = 90 + i * 17;
    const A = i % 2 ? ramp(['#3a0a4a', '#7a1f8f', '#c040b0', '#ff80d8']) : ramp(['#4a1008', '#8a2a10', '#e0601c', '#ffb050']);
    const B = i % 2 ? ramp(['#0a2a4a', '#145a8a', '#2aa0c0', '#80e8e8']) : ramp(['#0a1f4a', '#1a3f8a', '#3a78d8', '#8ec0ff']);
    return bake(w, h, (x, y) => {
      const ex = (x - w / 2) / (w / 2), ey = (y - h / 2) / (h / 2), mask = 1 - (ex * ex + ey * ey);
      if (mask <= 0) return 0;
      const d = fbm(x * 0.055, y * 0.055, seed) * (0.45 + mask), t = d - (0.34 + bayer(x, y) * 0.22);
      if (t <= 0) return 0;
      const rp = fbm(x * 0.03 + 5, y * 0.03, seed + 3) > 0.5 ? A : B;
      return rp[clamp(Math.floor(t * 9), 0, 3)];
    });
  });
}
function rockSprite(i) {
  return cached('rock' + i + '-' + (i > 3 ? 1 : 0), () => {
    const r = rng(7 + i * 5), S = 5 + (i % 4) * 2, pts = Array.from({ length: 9 }, (_, k) => [(k / 9) * TAU, S * (0.72 + r() * 0.4)]);
    const w = S * 2 + 3, hh = S * 2 + 3, rp = RAMPS.rock;
    return bake(w, hh, (x, y) => {
      const dx = x - w / 2 + 0.5, dy = y - hh / 2 + 0.5, a = (Math.atan2(dy, dx) + TAU) % TAU, k = Math.floor(a / TAU * 9), t = (a / TAU * 9) - k;
      const rr = mix(pts[k][1], pts[(k + 1) % 9][1], t), d = Math.hypot(dx, dy);
      if (d > rr) return 0;
      const L = clamp(0.62 - (dx * 0.5 + dy * 0.6) / (rr * 1.6), 0, 1) + (noise(x * 0.9, y * 0.9, i) > 0.78 ? -0.28 : 0);
      return rp[clamp(Math.round(L * 3 + (bayer(x, y) - 0.5) * 0.8), 0, 3)];
    });
  });
}
function blackHoleSprite(frame) {
  return cached('bh' + frame + '-' + U, () => {
    const w = Math.round(U * 0.95), h = Math.round(U * 0.5), cx = w / 2, cy = h / 2, rh = Math.round(U * 0.075);
    const disk = ramp(['#6a1408', '#c2400e', '#ff8a1a', '#ffd23f', '#ffffff']);
    return bake(w, h, (x, y) => {
      const dx = x - cx + 0.5, dy = y - cy + 0.5, d = Math.hypot(dx, dy);
      if (d < rh) return c32('#000000');
      const ex = dx / (w / 2), ey = dy / (h * 0.16), ed = Math.hypot(ex, ey);            // flat accretion disk
      const behind = dy < 0 && Math.abs(dx) < rh * 1.15;                                // the disk passes behind the hole...
      let c = 0;
      if (ed > 0.22 && ed < 1 && !behind) {
        const ang = Math.atan2(ey, ex), shimmer = Math.sin(ang * 5 - frame * 1.57 + ed * 9) * 0.5 + 0.5;
        const lvl = (1 - ed) * 4.2 + shimmer * 0.9 + (bayer(x, y) - 0.5);
        if (lvl > 0.5) c = disk[clamp(Math.floor(lvl), 0, 4)];
      }
      const lens = Math.hypot(dx / 1.0, dy * 1.25);                                      // ...and bends over the top and bottom
      if (lens > rh * 1.05 && lens < rh * 1.9 && Math.abs(dx) < rh * 1.6 && bayer(x, y) < 0.8 - (lens - rh) / (rh * 1.2) * 0.5) c = disk[clamp(Math.floor(2 + (1.9 * rh - lens) / rh * 2), 0, 4)];
      if (Math.abs(d - rh * 1.06) < 0.7) c = c32('#ffe9a8');                              // photon ring
      return c;
    });
  });
}
const SHIP_PAL = () => getColorSafe()
  ? { out: '#10162c', w: '#ffffff', m: '#dfe8f5', s: '#9fb0c8', d: '#7488aa', a: '#3d7bff', A: '#1f3f9a', g: '#4de1ff', G: '#d8fbff', n: '#3a4258' }
  : { out: '#10162c', w: '#ffffff', m: '#dfe8f5', s: '#9fb0c8', d: '#7488aa', a: '#ee4a3c', A: '#8e1f2e', g: '#4de1ff', G: '#d8fbff', n: '#3a4258' };
function shipSprite() {
  return cached('ship' + getColorSafe(), () => {
    const P = SHIP_PAL(), W = 27, H = 30, cx = 13, hull = [0, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4], pal = {};
    for (const k in P) pal[k] = c32(P[k]);
    return bake(W, H, (x, y) => {
      const dx = x - cx, ay = Math.abs(dx);
      if (y < hull.length && ay <= hull[y]) {                                     // body
        const hw = hull[y];
        if (y === 0) return pal.out;
        if (ay === hw) return pal.out;
        if (y <= 5) return dx < 0 ? pal.a : ay === hw - 1 ? pal.A : pal.a;       // painted nose cone
        if (y === 12 || y === 13) return ay === hw - 1 ? pal.A : pal.a;         // stripe
        const wy = y - 9, win = Math.hypot(dx, wy) < 3.2;
        if (win && y >= 6 && y <= 12) return Math.hypot(dx, wy) < 2.2 ? (dx < 0 && wy < 0 ? pal.G : pal.g) : pal.out;
        return dx < -hw + 2 ? pal.w : dx < 1 ? pal.m : dx < hw - 1 ? pal.s : pal.d;
      }
      if (y >= 14 && y <= 23) {                                                    // swept fins
        const k = y - 14, reach = 5 + Math.round(k * 0.62), ex = ay - 5;
        if (ex >= 1 && ex <= reach - (y > 21 ? 1 : 0) && ex <= (k + 2)) return y === 23 || ex === Math.min(reach, k + 2) ? pal.A : pal.a;
      }
      if (y >= 22 && y <= 25 && ay <= (y === 22 ? 4 : y === 23 ? 3 : 2)) return y === 22 ? pal.out : pal.n;  // engine bell
      return 0;
    });
  });
}
const SAT_PAL = { o: '#10162c', w: '#e8eefc', b: '#2a4fb8', B: '#4f7de8', y: '#ffd23f' };
const satSprite = () => cached('sat', () => spriteFromRows([
  'bBbBb..oo..bBbBb', 'bBbBb.owwo.bBbBb', 'bBbBbooWwoobBbBb'.replace('W', 'w'), 'bBbBb.owwo.bBbBb', 'bBbBb..oo..bBbBb', '......oyyo......'.replace('yy', 'o'),
], SAT_PAL));
const stationSprite = () => cached('station', () => spriteFromRows([
  '..bBbB..........................bBbB..', '..bBbB..........................bBbB..', '..bBbB....ooooooooooooooo.......bBbB..'.replace(/\./g, (m, i) => (i > 9 && i < 25 ? m : m)).slice(0, 38),
  '..bBbB....owwwwwwwwwwwwwo.......bBbB..', '..bBbB..oooowwwoooooowwwoooo....bBbB..', 'bBbBbBbBowwwwwwwwwwwwwwwwwwwobBbBbBbBb'.slice(0, 38),
  '..bBbB..oooowwwoooooowwwoooo....bBbB..', '..bBbB....owwwwwwwwwwwwwo.......bBbB..', '..bBbB....ooooooooooooooo.......bBbB..', '..bBbB..........................bBbB..',
].map(r => r.padEnd(38, '.').slice(0, 38)), SAT_PAL));

/* ---------------------------------------------------------------- world content */
const STAR_COLORS = ['#ffffff', '#cfe3ff', '#ffe9b8', '#9fb8ff'];
let stars = [], clouds = [], birds = [], rocks = [], dust = [], trail = [], shooters = [], nextShooter = 0;
const QUALITY = { high: { stars: 260, clouds: 15, rocks: 20, fps: 60 }, medium: { stars: 180, clouds: 12, rocks: 14, fps: 60 }, low: { stars: 110, clouds: 9, rocks: 9, fps: 30 } };
let tier = 'high';
function pickTier() {
  const manual = document.body?.dataset.graphics || 'auto';
  if (QUALITY[manual]) return manual;
  const touch = matchMedia('(hover:none) and (pointer:coarse)').matches || window.innerWidth < 700;
  const hc = navigator.hardwareConcurrency || 8, mem = navigator.deviceMemory || 8;
  return touch && (hc <= 4 || mem <= 4) ? 'low' : touch ? 'medium' : 'high';
}
function resize() {
  if (!canvas || !ctx) return;
  const cw = Math.max(1, window.innerWidth), ch = Math.max(1, window.innerHeight);
  scale = Math.max(2, Math.round(cw / 200));
  LW = Math.ceil(cw / scale); LH = Math.ceil(ch / scale);
  canvas.width = LW; canvas.height = LH;
  canvas.style.width = LW * scale + 'px'; canvas.style.height = LH * scale + 'px';
  ctx.imageSmoothingEnabled = false; lastFill = '';
  U = Math.min(LW, LH * 0.62);
  tier = pickTier(); fpsCap = QUALITY[tier].fps;
  cache.clear(); skyKey = -1;
  const q = QUALITY[tier], r = rng(11);
  stars = Array.from({ length: q.stars }, (_, i) => ({ x: r() * LW, y: r() * LH, layer: i % 3, c: STAR_COLORS[Math.floor(r() * 4)], tw: r() * TAU, big: r() < 0.09, order: r() }));
  clouds = Array.from({ length: q.clouds }, (_, i) => ({ x: r() * LW, alt: -0.03 + r() * 0.13, kind: i % 3, sp: 0.4 + r() * 0.9 }));
  birds = Array.from({ length: 6 }, () => ({ x: r() * LW, alt: 0.004 + r() * 0.035, ph: r() * TAU, sp: 0.3 + r() * 0.4 }));
  rocks = Array.from({ length: q.rocks }, (_, i) => ({ x: r() * LW, off: (r() - 0.5) * 0.09, kind: i % 8, par: 0.9 + r() * 0.5, rot: r() < 0.5 }));
}

/* ---------------------------------------------------------------- the world: bodies passed on the way up */
// at = flight units / MAXD (see ZONES and altitudeLabel in config.js for the matching distances)
const BODIES = [
  { id: 'moon', at: 2000, x: 0.72, draw: 'planet' }, { id: 'mars', at: 2300, x: 0.26, draw: 'planet' },
  { id: 'venus', at: 2450, x: 0.76, draw: 'planet' }, { id: 'sun', at: 2650, x: 0.52, draw: 'sun' },
  { id: 'jupiter', at: 2900, x: 0.68, draw: 'planet' }, { id: 'saturn', at: 3200, x: 0.30, draw: 'planet' },
  { id: 'neptune', at: 3480, x: 0.70, draw: 'planet' }, { id: 'belt', at: 2150, x: 0.5, draw: 'belt' },
  { id: 'neb0', at: 3900, x: 0.40, draw: 'nebula', n: 0 }, { id: 'pulsar', at: 4350, x: 0.74, draw: 'pulsar' },
  { id: 'neb1', at: 4550, x: 0.62, draw: 'nebula', n: 1 }, { id: 'gal0', at: 5000, x: 0.30, draw: 'galaxy', kind: 'blue' },
  { id: 'gal1', at: 5300, x: 0.74, draw: 'galaxy', kind: 'ellipse' }, { id: 'neb2', at: 5520, x: 0.30, draw: 'nebula', n: 2 },
  { id: 'gal2', at: 5600, x: 0.66, draw: 'galaxy', kind: 'pink' }, { id: 'bh', at: 5900, x: 0.5, draw: 'blackhole' },
].map(b => ({ ...b, at: b.at / MAXD }));
const PX_PER_STAGE = () => LH * 8;
const worldY = at => shipY - (at - visualDepth) * PX_PER_STAGE();

function drawStars(t, still, rush) {
  const reveal = smooth((visualStage - 0.06) / 0.12), ds = (visualDepth - prevStage) * PX_PER_STAGE();
  const n = Math.round(stars.length * reveal);
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i]; if (s.order * stars.length > n) continue;
    if (!still) {
      const par = [0.12, 0.3, 0.6][s.layer];
      s.y += ds * par + (0.05 + s.layer * 0.05) * (1 + rush * 6);
      if (s.y >= LH) { s.y -= LH; s.x = Math.random() * LW; } else if (s.y < 0) s.y += LH;
    }
    const twink = !still && Math.sin(t * 0.004 + s.tw) > 0.9;
    if (rush > 0.18 && s.layer > 0) { const L = Math.round(rush * (2 + s.layer * 5)); rect(s.x, s.y, 1, L, s.layer === 2 ? '#cfe3ff' : '#6f8fd0'); continue; }
    px(s.x, s.y, twink ? '#ffffff' : s.layer === 0 ? '#6f7fb0' : s.c);
    if (s.big) { const c = twink ? '#ffffff' : '#9fb8ff'; px(s.x - 1, s.y, c); px(s.x + 1, s.y, c); px(s.x, s.y - 1, c); px(s.x, s.y + 1, c); }
  }
}
function drawSkyThings(t, still) {
  const s = visualDepth;
  if (s < 0.2) {                                                 // sun in the sky, climbing out of view
    const sx = LW * 0.78, sy = LH * 0.15 - s * LH * 5;
    if (sy > -30) {
      const R = Math.round(U * 0.05) + 2;
      ring(sx, sy, R + 7, '#ffe9a8', 0.22); ring(sx, sy, R + 4, '#fff3c4', 0.45);
      for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) if (x * x + y * y <= R * R) px(sx + x, sy + y, x * x + y * y < R * R * 0.45 ? '#ffffff' : '#fff0a0');
    }
  }
  const ground = LH * 0.86 + s * PX_PER_STAGE() * 1.1;           // distant mountains and a cloud sea, left behind at take-off
  if (ground < LH + 40) {
    const r = rng(5);
    for (let layer = 0; layer < 2; layer++) {
      const base = ground + layer * 7, c = layer ? '#244f86' : '#3a6ba8', ph = r() * 9;
      for (let x = 0; x < LW; x++) {
        const h = 9 + Math.sin(x * 0.07 + ph) * 5 + Math.sin(x * 0.21 + layer) * 3 + (layer ? -3 : 4);
        rect(x, base - h, 1, h + 60, bayer(x, 4) < 0.25 ? '#4a7cb8' : c);
      }
    }
    rect(0, ground + 12, LW, 80, '#1d4170');
  }
  for (const c of clouds) {                                      // clouds: world anchored, drift sideways
    const y = shipY - (c.alt - s) * PX_PER_STAGE(); if (y < -30 || y > LH + 30) continue;
    const spr = cloudSprite(c.kind), x = ((c.x + (still ? 0 : t * 0.006 * c.sp)) % (LW + spr.width)) - spr.width;
    blit(spr, x, y);
  }
  for (const b of birds) {                                       // birds, only in the lowest sky
    const y = shipY - (b.alt - s) * PX_PER_STAGE(); if (y < -4 || y > LH + 4) continue;
    const x = ((b.x + (still ? 0 : t * 0.012 * b.sp)) % (LW + 10)) - 5, f = still ? 0 : Math.sin(t * 0.012 + b.ph) > 0 ? 1 : 0;
    px(x, y, '#10223f'); px(x - 1, y - f, '#10223f'); px(x + 1, y - f, '#10223f'); px(x - 2, y - f * 2 + 1, '#10223f'); px(x + 2, y - f * 2 + 1, '#10223f');
  }
}
function drawEarth() {
  const limb = LH * (1.05 - 0.42 * smooth((visualDepth - 0.08) / 0.1) + 0.5 * smooth((visualDepth - 0.3) / 0.14));
  if (limb < LH + 2) ctx.drawImage(earthCap(), 0, Math.round(limb) - 7);
}
function drawBodies(t, still) {
  for (const b of BODIES) {
    const y = worldY(b.at), x = b.x * LW;
    if (b.draw === 'planet') {
      const spr = planetSprite(b.id); if (!spr || y < -spr.height || y > LH + spr.height) continue;
      blit(spr, x - spr.width / 2, y - spr.height / 2);
      if (b.id === 'jupiter' || b.id === 'saturn') for (let k = 0; k < 2; k++) { const a = t * 0.0004 * (k + 1) + k * 2, mx = x + Math.cos(a) * spr.width * 0.62, my = y + Math.sin(a) * 4 - (k ? 6 : -8); px(mx, my, '#e8e0cc'); px(mx + 1, my, '#a89a80'); }
    } else if (b.draw === 'sun') {
      const R = Math.round(U * 0.2); if (y < -R * 2.4 || y > LH + R * 2.4) continue;
      const spr = cached('sun-' + R, () => bakeSphere(R, () => RAMPS.sun, [0, 0, 1])), fl = still ? 0 : Math.floor(t / 140);
      for (let i = 0; i < 16; i++) {                               // flickering rays
        const a = (i / 16) * TAU + (i % 2 ? 0.07 : 0), len = 5 + ((i * 7 + fl) % 5) * 2 + (i % 3) * 2;
        line(x + Math.cos(a) * (R + 2), y + Math.sin(a) * (R + 2), x + Math.cos(a) * (R + 2 + len), y + Math.sin(a) * (R + 2 + len), (k, n) => (k < n * 0.5 ? '#ffd23f' : '#ff8a1a'));
      }
      ring(x, y, R + 4 + (fl % 3), '#ffb02e', 0.5); ring(x, y, R + 10 + (fl % 4), '#ff7a1a', 0.28); ring(x, y, R + 18, '#c2400e', 0.14);
      blit(spr, x - spr.width / 2, y - spr.height / 2);
    } else if (b.draw === 'belt') {
      if (Math.abs(y - LH / 2) > LH) continue;
      for (const r of rocks) {
        const ry = shipY - (b.at - visualDepth) * PX_PER_STAGE() * r.par + r.off * PX_PER_STAGE(); if (ry < -20 || ry > LH + 20) continue;
        const spr = rockSprite(r.kind), rx = (r.x + (still ? 0 : t * 0.004 * r.par)) % (LW + 20) - 10;
        blit(spr, rx, ry);
      }
    } else if (b.draw === 'nebula') {
      const spr = nebulaSprite(b.n); if (y < -spr.height || y > LH + spr.height) continue;
      blit(spr, x - spr.width / 2, y - spr.height / 2);
    } else if (b.draw === 'galaxy') {
      const f = still ? 0 : Math.floor(t / 500) % 8, spr = galaxySprite(b.kind, f); if (y < -spr.height || y > LH + spr.height) continue;
      blit(spr, x - spr.width / 2, y - spr.height / 2);
    } else if (b.draw === 'pulsar') {
      if (y < -90 || y > LH + 90) continue;
      const a = (still ? 0 : Math.floor(t / 110) % 16) * (Math.PI / 8), L = Math.round(U * 0.45);
      for (const sgn of [1, -1]) line(x, y, x + Math.cos(a) * L * sgn, y + Math.sin(a) * L * sgn, (k, n) => (bayer(k, k * 3) < 1 - k / n ? (k < n * 0.4 ? '#ffffff' : '#7fe3ff') : null));
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) px(x + dx, y + dy, '#ffffff');
      ring(x, y, 4, '#7fe3ff', 0.6);
    } else if (b.draw === 'blackhole') {
      const spr = blackHoleSprite(still ? 0 : Math.floor(t / 220) % 4); if (y < -spr.height || y > LH + spr.height) continue;
      blit(spr, x - spr.width / 2, y - spr.height / 2);
    }
  }
}
function drawWarpAndShooters(t, dt, still, rush) {
  if (!still && visualStage > 0.14) {                            // ambient shooting stars
    if (t > nextShooter) { nextShooter = t + rand(1400, 4200); shooters.push({ x: rand(0, LW * 1.1), y: rand(-10, LH * 0.35), start: t, dur: 520, len: rand(7, 15), dx: rand(0.7, 1.2) * (Math.random() < 0.5 ? -1 : 1), dy: 1 }); }
  }
  shooters = shooters.filter(s => t - s.start < s.dur);
  for (const s of shooters) {
    const p = (t - s.start) / s.dur, hx = s.x + s.dx * p * 90, hy = s.y + s.dy * p * 90;
    line(hx, hy, hx - s.dx * s.len, hy - s.dy * s.len, (k, n) => (k < 2 ? '#ffffff' : k < n * 0.55 ? '#bfe3ff' : k < n * 0.85 ? '#5f86d0' : null));
  }
  if (rush > 0.4 && !still) {                                    // hyperspace streaks
    for (let i = 0; i < 14; i++) { const x = (i * 37 + Math.floor(t / 70) * 11) % LW, y = (i * 53 + Math.floor(t / 40) * 23) % LH, L = 8 + (i % 4) * 5; rect(x, y, 1, L, i % 3 ? '#9fb8ff' : '#ffffff'); }
  }
}

/* ---------------------------------------------------------------- the ship */
function drawShip(t, still, craftX, craftY, panic = 0, hitFlash = false) {
  const spr = shipSprite(), thrust = still ? 0.2 : clamp(0.16 + sinkSmooth * 0.95, 0, 1);
  const bob = still ? 0 : Math.round(Math.sin(t * 0.0021) * 1.2), sway = still ? 0 : Math.round(Math.sin(t * 0.0013) * 2 + (panic ? Math.sin(t * 0.05) * 2 * panic : 0));
  const x = Math.round(craftX ?? LW / 2) - 13 + sway, y = Math.round(craftY ?? LH * 0.6) - 15 + bob;
  const nx = x + 13, ny = y + 26;
  const L = 3 + Math.round(thrust * 11) + (still ? 0 : Math.floor(t / 55) % 3);                  // flame
  for (let i = 0; i < L; i++) {
    const hw = Math.max(0, 2 - Math.floor(i / (L / 3 + 0.5))), c = i < 2 ? '#fff6c8' : i < L * 0.55 ? '#ffd23f' : '#ff7a1a';
    rect(nx - hw, ny + i, hw * 2 + 1, 1, c);
    if (hw >= 1 && i < L * 0.7) rect(nx, ny + i, 1, 1, '#ffffff');
  }
  if (!still && Math.random() < 0.55 + thrust * 0.4) trail.push({ x: nx + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.4 ? 1 : 0), y: ny + L - 1, vy: 22 + thrust * 90 + Math.random() * 20, life: 0, max: 380 + Math.random() * 380, w: visualDepth < 0.12 });
  blit(spr, x, y);
  if (hitFlash) rect(x, y, spr.width, spr.height, 'rgba(255,255,255,.55)');
}
function drawTrail(dt, still) {
  trail = trail.filter(p => p.life < p.max);
  for (const p of trail) {
    if (!still) { p.life += dt; p.y += p.vy * dt / 1000; }
    const f = p.life / p.max, c = p.w ? (f < 0.4 ? '#ffffff' : f < 0.75 ? '#cfe6ff' : '#9fc4ee') : (f < 0.25 ? '#ffd23f' : f < 0.55 ? '#ff7a1a' : '#a83a1a');
    if (p.w) rect(p.x - (f > 0.5 ? 1 : 0), p.y, f > 0.5 ? 3 : 2, 2, c); else if (bayer(p.x, p.y) > f * 0.9) px(p.x, p.y, c);
  }
}

/* ---------------------------------------------------------------- encounters */
const MISS_CAPTIONS = [
  'An asteroid the size of a bus missed you by a whisker.', 'A rogue space rock tried to steal your lane.',
  'A cosmic ray photobombed your cockpit.', 'Mission control says: "Nope."', 'A very rude meteor cut in front of you.',
  'A space pigeon refused to give way.', 'The asteroid sends its regards.',
];
function addFeedbackCaption(caption) {
  const feedback = document.getElementById('feedback');
  if (feedback && caption) feedback.textContent = [feedback.textContent, caption].filter(Boolean).join(' ');
}
function focusSceneBriefly(ms = 980) {
  if (!document.body) return;
  document.body.classList.add('scene-focus');
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = setTimeout(() => { document.body.classList.remove('scene-focus'); focusTimer = 0; }, ms);
}
export function triggerAnswerVisual(points, state) {
  const failed = state !== 'hit';
  if (isStill()) {
    if (failed || points <= 20) addFeedbackCaption(MISS_CAPTIONS[Math.floor(Math.random() * MISS_CAPTIONS.length)]);
    else if (points >= 70) addFeedbackCaption('A rare wonder glides past in the still sky.');
    eventScene = null; document.body?.classList.remove('scene-focus'); return;
  }
  if (failed || points <= 20) {
    const caption = MISS_CAPTIONS[Math.floor(Math.random() * MISS_CAPTIONS.length)];
    addFeedbackCaption(caption);
    eventScene = { kind: 'asteroid', start: performance.now(), duration: 1900, dir: Math.random() < 0.5 ? -1 : 1, rock: Math.floor(rand(0, 8)) };
    focusSceneBriefly(1000); predatorGulp();
    if (getHaptics()) { try { if (navigator.vibrate) navigator.vibrate([24, 28, 48]); } catch { /* optional */ } }
    return;
  }
  const pool = points <= 40 ? ['comet', 'meteors', 'satellite'] : points <= 60 ? ['station', 'comet', 'meteors'] : points <= 80 ? ['station', 'supernova', 'satellite'] : points <= 94 ? ['supernova', 'wormhole', 'meteors'] : ['wormhole', 'supernova'];
  if (points >= 70) rareSparkle();
  eventScene = { kind: pool[Math.floor(Math.random() * pool.length)], start: performance.now(), duration: 2000, dir: Math.random() < 0.5 ? -1 : 1, seed: Math.random() };
}
export function triggerPredatorAttack() { triggerAnswerVisual(0, 'miss'); }

function drawEvent(t, now, still) {
  const e = eventScene; if (!e || still) return { dx: 0, panic: 0, flash: false, shake: 0 };
  const p = clamp((now - e.start) / e.duration, 0, 1); e.p = p;
  const out = { dx: 0, panic: 0, flash: false, shake: 0 };
  if (e.kind === 'asteroid') {
    const k = 1.6 + Math.sin(p * Math.PI) * 2.8, spr = rockSprite(e.rock), cxp = e.dir > 0 ? mix(-30, LW + 30, p) : mix(LW + 30, -30, p), cyp = mix(LH * 0.05, LH * 0.68, p);
    blitScaled(spr, cxp - spr.width * k / 2, cyp - spr.height * k / 2, k);
    for (let i = 0; i < 6; i++) { const q = clamp(p - i * 0.025, 0, 1), dx = e.dir > 0 ? mix(-30, LW + 30, q) : mix(LW + 30, -30, q), dy = mix(LH * 0.05, LH * 0.68, q); px(dx + (i % 2 ? 2 : -2), dy - 4 - i * 2, i < 3 ? '#ff9a1a' : '#a83a1a'); }
    const near = 1 - clamp(Math.abs(p - 0.55) / 0.12, 0, 1);
    out.panic = smooth((p - 0.25) / 0.2) * (1 - smooth((p - 0.7) / 0.2)); out.dx = -e.dir * out.panic * 9; out.shake = near > 0 ? 1 : 0; out.flash = near > 0.55;
  } else if (e.kind === 'comet' || e.kind === 'meteors') {
    const n = e.kind === 'comet' ? 1 : 9;
    for (let i = 0; i < n; i++) {
      const q = clamp(p * 1.4 - i * 0.07, 0, 1); if (q <= 0 || q >= 1) continue;
      const sx = e.kind === 'comet' ? (e.dir > 0 ? -10 : LW + 10) : (hash2(i, 1, 3) * LW * 1.2), sy = e.kind === 'comet' ? LH * 0.08 : -8 - hash2(i, 2, 3) * 40;
      const dir = e.kind === 'comet' ? e.dir : (i % 2 ? 1 : -1), hx = sx + dir * q * (e.kind === 'comet' ? LW * 1.3 : 120), hy = sy + q * (e.kind === 'comet' ? LH * 0.55 : LH * 0.7), L = e.kind === 'comet' ? 46 : 14;
      line(hx, hy, hx - dir * L * 0.95, hy - L * 0.55, (k, m) => (k < 3 ? '#ffffff' : k < m * 0.4 ? (e.kind === 'comet' ? '#9ff0ff' : '#ffe9a8') : k < m * 0.75 ? (e.kind === 'comet' ? '#3d8bf0' : '#ff9a1a') : bayer(k, k) < 0.5 ? '#1d3f8a' : null));
      if (e.kind === 'comet') for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]]) px(hx + ox, hy + oy, '#ffffff');
    }
  } else if (e.kind === 'satellite' || e.kind === 'station') {
    const spr = e.kind === 'satellite' ? satSprite() : stationSprite(), x = e.dir > 0 ? mix(-spr.width - 4, LW + 4, p) : mix(LW + 4, -spr.width - 4, p), y = LH * (e.kind === 'satellite' ? 0.2 : 0.3) + Math.sin(p * 5) * 2;
    blit(spr, x, y); if (Math.floor(t / 250) % 2) px(x + spr.width / 2, y + spr.height, '#ff4040');
  } else if (e.kind === 'supernova') {
    const cx = LW * (e.seed < 0.5 ? 0.3 : 0.7), cy = LH * 0.28, r = p * LW * 0.75;
    if (p < 0.08) rect(0, 0, LW, LH, p < 0.04 ? '#ffffff' : '#ffe9a8');
    ring(cx, cy, r, '#ffffff', 1 - p, 1); ring(cx, cy, r * 0.82, '#ffd23f', 0.9 - p * 0.8, 1); ring(cx, cy, r * 0.6, '#ff7a1a', 0.8 - p * 0.7, 1); ring(cx, cy, r * 0.38, '#c2400e', 0.7 - p * 0.6, 1);
    const R0 = Math.round((1 - p) * 7); for (let y = -R0; y <= R0; y++) for (let x = -R0; x <= R0; x++) if (x * x + y * y <= R0 * R0) px(cx + x, cy + y, '#ffffff');
  } else if (e.kind === 'wormhole') {
    const cx = LW / 2, cy = LH * 0.36, cols = ['#7fe3ff', '#e060ff', '#ffffff', '#3d8bf0', '#ff80d8'];
    for (let i = 0; i < 9; i++) { const q = (i / 9 + p * 1.2) % 1, r = q * q * LW * 0.62 + 2; ring(cx, cy, r, cols[i % 5], 0.35 + q * 0.65, 1); }
    if (p > 0.82 && p < 0.9) rect(0, 0, LW, LH, '#ffffff');
  }
  if (p >= 1) eventScene = null;
  return out;
}

/* ---------------------------------------------------------------- zone banner and wipe */
function checkZone(time) {
  let z = 0; for (let i = 0; i < ZONES.length; i++) { const start = i ? ZONES[i - 1].end : 0; if (visualDepth * MAXD >= start + 14) z = i; }
  if (z === zoneIndex) return;
  const deeper = z > zoneIndex; zoneIndex = z;
  if (!deeper || !document.getElementById('game')?.classList.contains('active')) return;
  zoneWipe = { start: time };
  if (!bannerEl) { bannerEl = document.createElement('div'); bannerEl.className = 'zone-banner'; bannerEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(bannerEl); }
  bannerEl.innerHTML = '<small>Entering</small><b></b>'; bannerEl.lastChild.textContent = ZONES[z].label;
  bannerEl.classList.remove('show'); void bannerEl.offsetWidth; bannerEl.classList.add('show');
}
function drawWipe(time) {                                        // a dithered scan line sweeps down when a new zone begins
  if (!zoneWipe) return;
  const p = (time - zoneWipe.start) / 1100; if (p >= 1) { zoneWipe = null; return; }
  const y0 = Math.round(p * (LH + 24)) - 24;
  for (let y = Math.max(0, y0); y < Math.min(LH, y0 + 24); y++) { const f = (y - y0) / 24; for (let x = (y & 1); x < LW; x += 2) if (bayer(x, y) > f * 0.95) px(x, y, f < 0.15 ? '#ffffff' : '#bfe9ff'); }
}

/* ---------------------------------------------------------------- loop */
function frame(time) {
  if (!ctx || !canvas || document.hidden) { frameStarted = false; return; }
  if (fpsCap < 60 && lastDraw && time - lastDraw < 1000 / fpsCap - 2) { rafHandle = requestAnimationFrame(frame); return; }
  lastDraw = time;
  const still = Boolean(isStill()), delta = still ? 0 : Math.min(42, previousTime ? time - previousTime : 16);
  const target = clamp((Number(getDepth()) || 0) / MAXD, 0, 1);       // the scene only climbs with earned altitude
  if (!still) {
    previousTime = time; frozenTime = 0; prevStage = visualDepth;
    visualStage += (target - visualStage) * (1 - Math.exp(-delta / 1900));
    visualDepth += (target - visualDepth) * (1 - Math.exp(-delta / 2600));
  } else if (!frozenTime) frozenTime = time;
  sinkSmooth = still ? 0 : sinkSmooth + (clamp((target - visualDepth) * 22, 0, 1) - sinkSmooth) * (1 - Math.exp(-delta / 420));
  const t = still ? (frozenTime || time) : time, now = performance.now();

  const inGame = document.getElementById('game')?.classList.contains('active'), shipTarget = LH * (inGame ? (LW / LH > 0.8 ? 0.55 : 0.3) : 0.5);
  shipY = shipY ? shipY + (shipTarget - shipY) * (still ? 1 : 1 - Math.exp(-delta / 400)) : shipTarget;
  ctx.setTransform(1, 0, 0, 1, 0, 0); lastFill = '';
  paintSky(visualDepth);
  drawStars(t, still, sinkSmooth);
  drawEarth();
  drawSkyThings(t, still);
  drawBodies(t, still);
  drawWarpAndShooters(t, delta, still, sinkSmooth);

  const ev = drawEvent(t, now, still);
  if (ev.shake) ctx.setTransform(1, 0, 0, 1, Math.random() < 0.5 ? -1 : 1, Math.random() < 0.5 ? -1 : 0);
  drawTrail(delta, still);
  drawShip(t, still, LW / 2 + ev.dx, shipY, ev.panic, false);
  ctx.setTransform(1, 0, 0, 1, 0, 0); lastFill = '';
  if (ev.flash) rect(0, 0, LW, LH, '#ffffff');
  drawWipe(time);
  checkZone(time);
  if (!document.hidden) rafHandle = requestAnimationFrame(frame); else frameStarted = false;
}

function startRenderLoop() {
  if (frameStarted || document.hidden || !ctx || !canvas) return;
  frameStarted = true; previousTime = 0; rafHandle = requestAnimationFrame(frame);
}
function onVisibilityChange() {
  if (document.hidden) { if (rafHandle) cancelAnimationFrame(rafHandle); rafHandle = 0; frameStarted = false; return; }
  startRenderLoop();
}
export function startScene(depthFn, stillFn, _progressFn, hapticsFn, colorSafeFn) {
  getDepth = typeof depthFn === 'function' ? depthFn : getDepth;
  isStill = typeof stillFn === 'function' ? stillFn : isStill;
  getHaptics = typeof hapticsFn === 'function' ? hapticsFn : getHaptics;
  getColorSafe = typeof colorSafeFn === 'function' ? colorSafeFn : getColorSafe;
  resize();
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  startRenderLoop();
}
export function resetDiveVisual() {
  visualDepth = 0; visualStage = 0; sinkSmooth = 0; prevStage = 0; zoneIndex = 0; zoneWipe = null; eventScene = null; previousTime = 0; frozenTime = 0; trail = []; shooters = [];
}
