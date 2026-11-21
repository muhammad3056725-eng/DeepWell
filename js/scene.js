// Procedural underwater world for DEEPWELL.
// All creatures, scenery, lighting and attack effects are drawn at runtime with Canvas 2D.
// No image, video, sprite, texture or external visual assets are used.
import { CONFIG } from './config.js';

const canvas = document.getElementById('scene');
let ctx = canvas?.getContext('2d', { alpha: false });
let attackCanvas = null;
let attackCtx = null;
let getDepth = () => 0;
let isStill = () => false;
let bubbles = [];
let fish = [];
let kelp = [];
let lastSpecies = -1;
let predator = null;
let lastFrame = 0;
let threeDRenderer = null;
let threeDActive = false;

const species = [
  { name: 'Great white', color: '#9eb8c5', belly: '#e7f4ef', fin: '#506d80', eye: '#07131b', shape: 'shark' },
  { name: 'Tiger shark', color: '#657e8b', belly: '#d9e8e7', fin: '#344e60', eye: '#07131b', shape: 'tiger' },
  { name: 'Hammerhead', color: '#819aa6', belly: '#e0eeee', fin: '#456276', eye: '#08151c', shape: 'hammer' },
  { name: 'Barracuda', color: '#a6c0bf', belly: '#e9f1d9', fin: '#557d82', eye: '#101a1d', shape: 'long' },
  { name: 'Giant grouper', color: '#547c72', belly: '#c1d4ad', fin: '#284e4c', eye: '#101b17', shape: 'round' },
  { name: 'Moray eel', color: '#789d67', belly: '#b4c58c', fin: '#405f45', eye: '#171d12', shape: 'eel' },
  { name: 'Anglerfish', color: '#415b70', belly: '#9bb2b8', fin: '#203648', eye: '#e9f6a8', shape: 'angler' },
  { name: 'Sawfish', color: '#7a9b9a', belly: '#d3e3d5', fin: '#3c6267', eye: '#0a1a20', shape: 'saw' }
];

const reefColors = ['#ff795e', '#ffb45f', '#e66cae', '#a5e36d', '#65d8cf', '#a58bf0'];
const fishColors = ['#ffbd59', '#ff7f70', '#6ce5d2', '#b7a0ff', '#f17ab2', '#a8e77c', '#66baff'];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;

export function startScene(depthFn, stillFn) {
  getDepth = typeof depthFn === 'function' ? depthFn : getDepth;
  isStill = typeof stillFn === 'function' ? stillFn : isStill;
  // Separate transparent overlay lets the predator pass in front of the HUD without blocking input.
  if (!attackCanvas) {
    attackCanvas = document.createElement('canvas');
    attackCanvas.id = 'predator-scene';
    attackCanvas.setAttribute('aria-hidden', 'true');
    attackCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
    document.body.appendChild(attackCanvas);
    attackCtx = attackCanvas.getContext('2d');
  }
  resize();
  addEventListener('resize', resize, { passive: true });
  requestAnimationFrame(frame);
  // Prefer the WebGL renderer. The existing Canvas animation remains as an automatic fallback.
  import('./scene3d.js').then(mod => {
    try {
      mod.startScene3D(getDepth, isStill, canvas);
      threeDRenderer = mod;
      threeDActive = true;
      if (attackCanvas) attackCanvas.style.display = 'none';
      canvas.dataset.renderer = 'fallback';
    } catch (error) {
      console.warn('DEEPWELL 3D renderer unavailable; using Canvas fallback.', error);
      try { mod.stopScene3D(); } catch {}
    }
  }).catch(error => {
    console.warn('DEEPWELL 3D module failed to load; using Canvas fallback.', error);
  });
}

// Called only by the answer-resolution path. It changes visuals only; no game state.
export function triggerPredatorAttack() {
  if (threeDActive && threeDRenderer) {
    threeDRenderer.triggerPredatorAttack();
    return;
  }
  let pick = Math.floor(Math.random() * species.length);
  if (species.length > 1 && pick === lastSpecies) pick = (pick + 1 + Math.floor(Math.random() * (species.length - 1))) % species.length;
  lastSpecies = pick;
  predator = {
    species: pick,
    side: Math.random() < 0.5 ? 'left' : 'right',
    start: performance.now(),
    duration: 1380,
  };
}

function resize() {
  if (!canvas || !ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(innerWidth * dpr);
  attackCanvas.width = Math.floor(innerWidth * dpr);
  attackCanvas.height = Math.floor(innerHeight * dpr);
  attackCanvas.style.width = innerWidth + 'px';
  attackCanvas.style.height = innerHeight + 'px';
  attackCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  bubbles = Array.from({ length: Math.min(120, Math.floor(innerWidth / 7)) }, () => ({
    x: rand(0, innerWidth), y: rand(0, innerHeight), r: rand(0.7, 3.1),
    speed: rand(0.18, 0.78), drift: rand(0.3, 1.6), phase: rand(0, Math.PI * 2),
    alpha: rand(0.16, 0.58),
  }));
  fish = Array.from({ length: Math.min(30, Math.max(18, Math.floor(innerWidth / 52))) }, (_, i) => ({
    // Normalized lane coordinates and a near/far depth value for perspective projection.
    x: rand(-0.43, 0.43), y: rand(-0.24, 0.28), z: rand(0.02, 0.84),
    size: rand(0.92, 1.48), speed: rand(0.000035, 0.000085),
    color: fishColors[i % fishColors.length], phase: rand(0, Math.PI * 2),
  }));
  kelp = Array.from({ length: 14 }, (_, i) => ({
    x: (i / 13) * innerWidth + rand(-22, 22), height: rand(50, 145),
    width: rand(5, 13), phase: rand(0, Math.PI * 2), color: ['#1a897b', '#287c73', '#4a9a76'][i % 3],
  }));
}

function waterColor(depth) {
  if (depth < 0.18) return ['#0c8491', '#07536e', '#03283d'];
  if (depth < 0.42) return ['#075d83', '#063c60', '#031b35'];
  if (depth < 0.68) return ['#123b62', '#102844', '#060f28'];
  return ['#101f43', '#09142e', '#020713'];
}

function drawWater(w, h, depth, time) {
  const colors = waterColor(depth);
  const g = ctx.createLinearGradient(0, 0, w * 0.15, h);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.46, colors[1]);
  g.addColorStop(1, colors[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Sun halo and broad, moving shafts in the upper water.
  if (depth < 0.78) {
    const strength = 0.23 * (1 - depth / 0.9);
    const halo = ctx.createRadialGradient(w * 0.5, -h * 0.08, 8, w * 0.5, h * 0.05, h * 0.78);
    halo.addColorStop(0, 'rgba(187,255,225,' + strength + ')');
    halo.addColorStop(1, 'rgba(70,206,228,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h * 0.9);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 8; i++) {
      const x = w * (0.06 + i * 0.13) + Math.sin(time * 0.00018 + i * 1.7) * 42;
      const width = w * (0.035 + (i % 3) * 0.012);
      const beam = ctx.createLinearGradient(x, 0, x + width * 0.6, h * 0.78);
      beam.addColorStop(0, 'rgba(157,255,231,' + (strength * 0.9) + ')');
      beam.addColorStop(0.65, 'rgba(92,220,226,' + (strength * 0.2) + ')');
      beam.addColorStop(1, 'rgba(92,220,226,0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(x - width * 0.12, 0);
      ctx.lineTo(x + width * 0.55, 0);
      ctx.lineTo(x + width * 1.7, h * 0.82);
      ctx.lineTo(x - width * 1.5, h * 0.82);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Procedural caustic ribbons; they dissolve as the diver descends.
  if (depth < 0.48) {
    ctx.save();
    ctx.globalAlpha = (0.11 + (0.48 - depth) * 0.28);
    ctx.strokeStyle = '#9ffff0';
    ctx.lineWidth = 1.1;
    for (let row = 0; row < 8; row++) {
      const y = h * (0.08 + row * 0.067);
      ctx.beginPath();
      for (let x = -20; x <= w + 20; x += 24) {
        const yy = y + Math.sin(x * 0.016 + time * 0.0007 + row) * 8
          + Math.sin(x * 0.008 - time * 0.00045) * 6;
        if (x === -20) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  const haze = ctx.createLinearGradient(0, h * 0.55, 0, h);
  haze.addColorStop(0, 'rgba(8,31,48,0)');
  haze.addColorStop(1, 'rgba(0,5,16,' + (0.18 + depth * 0.36) + ')');
  ctx.fillStyle = haze;
  ctx.fillRect(0, h * 0.5, w, h * 0.5);
}

function drawBubble(x, y, r, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#bafaff';
  ctx.lineWidth = Math.max(0.65, r * 0.22);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(217,255,255,0.22)';
  ctx.beginPath();
  ctx.arc(x - r * 0.28, y - r * 0.3, Math.max(0.5, r * 0.19), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAmbient(w, h, time, still, depth) {
  for (const p of bubbles) {
    if (!still) {
      p.y -= p.speed * (0.55 + depth * 0.3);
      p.x += Math.sin(time * 0.0007 + p.phase) * p.drift * 0.035;
      if (p.y < -8) { p.y = h + 8; p.x = rand(0, w); }
    }
    drawBubble(p.x, p.y, p.r, p.alpha);
  }

  // Tiny plankton and suspended marine snow.
  for (let i = 0; i < 42; i++) {
    const x = (i * 97.31 + Math.sin(time * 0.00016 + i) * 24) % w;
    const y = (i * 61.73 + (still ? 0 : time * (0.004 + (i % 4) * 0.001))) % h;
    ctx.fillStyle = 'rgba(202,255,243,' + (0.08 + (i % 5) * 0.035) + ')';
    ctx.beginPath();
    ctx.arc(x, y, 0.7 + (i % 3) * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSmallFish(x, y, size, color, direction, phase, time, alpha = 0.9) {
  const len = 58 * size;
  const ht = 25 * size;
  ctx.save();
  ctx.translate(x, y + Math.sin(time * 0.003 + phase) * 3 * size);
  ctx.scale(direction, 1);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = 9 * size;
  // Forked tail.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-len * 0.38, 0);
  ctx.lineTo(-len * 0.72, -ht * 0.48);
  ctx.quadraticCurveTo(-len * 0.61, 0, -len * 0.72, ht * 0.48);
  ctx.closePath();
  ctx.fill();
  // Body with a softly lit belly.
  const body = ctx.createLinearGradient(0, -ht * 0.55, 0, ht * 0.6);
  body.addColorStop(0, '#f8fff0');
  body.addColorStop(0.28, color);
  body.addColorStop(1, '#17526a');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-len * 0.43, 0);
  ctx.quadraticCurveTo(-len * 0.18, -ht * 0.78, len * 0.32, -ht * 0.32);
  ctx.quadraticCurveTo(len * 0.58, 0, len * 0.32, ht * 0.32);
  ctx.quadraticCurveTo(-len * 0.18, ht * 0.78, -len * 0.43, 0);
  ctx.fill();
  // Dorsal and lower fins.
  ctx.beginPath();
  ctx.moveTo(-len * 0.08, -ht * 0.46);
  ctx.lineTo(len * 0.08, -ht * 0.92);
  ctx.lineTo(len * 0.23, -ht * 0.39);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-len * 0.02, ht * 0.4);
  ctx.lineTo(len * 0.17, ht * 0.78);
  ctx.lineTo(len * 0.2, ht * 0.29);
  ctx.closePath();
  ctx.fill();
  // Pectoral fin.
  ctx.globalAlpha *= 0.75;
  ctx.beginPath();
  ctx.moveTo(-len * 0.02, ht * 0.12);
  ctx.lineTo(len * 0.17, ht * 0.58);
  ctx.lineTo(len * 0.28, ht * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(6,40,55,0.55)';
  ctx.lineWidth = Math.max(0.6, size);
  ctx.beginPath();
  ctx.arc(len * 0.17, 0, ht * 0.24, -0.9, 0.9);
  ctx.stroke();
  ctx.fillStyle = '#061b24';
  ctx.beginPath();
  ctx.arc(len * 0.34, -ht * 0.1, Math.max(1, size * 1.35), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(len * 0.36, -ht * 0.16, Math.max(0.45, size * 0.48), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawApproachingFish(x, y, scale, color, phase, time, alpha = 0.9) {
  // Front-on fish silhouette: nose, eyes and mouth face the player.
  ctx.save();
  ctx.translate(x, y + Math.sin(time * 0.002 + phase) * 2.8 * scale);
  ctx.rotate(Math.sin(time * 0.0008 + phase) * 0.045);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = 13;

  // Tail and dorsal fin sit behind the body, reinforcing the forward-swimming perspective.
  ctx.fillStyle = '#164b62';
  ctx.beginPath();
  ctx.moveTo(0, -58); ctx.lineTo(-23, -98); ctx.lineTo(-5, -88);
  ctx.lineTo(0, -112); ctx.lineTo(8, -88); ctx.lineTo(25, -98);
  ctx.lineTo(14, -58); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-10, -35); ctx.lineTo(0, -65); ctx.lineTo(13, -34); ctx.closePath(); ctx.fill();

  // Pectoral fins angle back and outward as if pushing water behind the fish.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-22, -8); ctx.quadraticCurveTo(-62, -30, -82, -53);
  ctx.quadraticCurveTo(-72, -4, -38, 24); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(22, -8); ctx.quadraticCurveTo(62, -30, 82, -53);
  ctx.quadraticCurveTo(72, -4, 38, 24); ctx.closePath(); ctx.fill();

  const body = ctx.createLinearGradient(-48, -20, 48, 32);
  body.addColorStop(0, '#174d65');
  body.addColorStop(0.28, color);
  body.addColorStop(0.52, '#e5ffff');
  body.addColorStop(0.75, color);
  body.addColorStop(1, '#103b56');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -77);
  ctx.bezierCurveTo(-28, -54, -47, -28, -43, 7);
  ctx.quadraticCurveTo(-39, 44, 0, 56);
  ctx.quadraticCurveTo(39, 44, 43, 7);
  ctx.bezierCurveTo(47, -28, 28, -54, 0, -77);
  ctx.closePath(); ctx.fill();

  // Face details and highlights.
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(4,24,39,0.78)';
  ctx.beginPath(); ctx.ellipse(-23, -4, 9, 7, -0.18, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(23, -4, 9, 7, 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f5ffff';
  ctx.beginPath(); ctx.arc(-23, -4, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(23, -4, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#061724';
  ctx.beginPath(); ctx.arc(-23, -4, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(23, -4, 1.8, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = 'rgba(5,36,51,0.72)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(-31 + i * 3, 15, 10 + i * 2, -0.48, 0.52);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(31 - i * 3, 15, 10 + i * 2, Math.PI - 0.52, Math.PI + 0.48);
    ctx.stroke();
  }
  ctx.fillStyle = '#102638';
  ctx.beginPath(); ctx.ellipse(0, 33, 15, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(226,255,249,0.62)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 32, 16, 0.15, Math.PI - 0.15); ctx.stroke();
  ctx.restore();
}

function drawFishSchools(w, h, time, still, depth, delta) {
  for (const f of fish) {
    if (!still) {
      f.z += f.speed * delta;
      f.phase += delta * 0.00045;
      if (f.z > 1.02) {
        f.z = rand(0.005, 0.06);
        f.x = rand(-0.43, 0.43);
        f.y = rand(-0.24, 0.28);
      }
    }

    // Perspective makes each fish grow and spread outward as it swims out of the distant water.
    const perspective = 0.18 + f.z * 1.08;
    const px = w * 0.5 + f.x * w * perspective;
    const py = h * 0.34 + f.y * h * perspective;
    const scale = (0.36 + f.z * 1.5) * f.size;
    const alpha = 0.32 + f.z * 0.52;
    if (px > -190 && px < w + 190 && py > -180 && py < h + 180) {
      drawApproachingFish(px, py, scale, f.color, f.phase, time, alpha);
    }
  }

  // A closer foreground school gives the water column a strong sense of scale.
  if (depth < 0.78) {
    for (let i = 0; i < 5; i++) {
      const x = w * (0.17 + i * 0.16) + Math.sin(time * 0.00055 + i * 1.4) * 45;
      const y = h * (0.2 + (i % 3) * 0.085);
      const scale = 0.72 + (i % 3) * 0.18;
      drawApproachingFish(x, y, scale, fishColors[(i + 3) % fishColors.length], i * 2.3, time, 0.72);
    }
  }
}

function branchCoral(x, y, angle, length, width, level, color, time) {
  if (level <= 0 || length < 3) return;
  const sway = Math.sin(time * 0.0007 + x * 0.02 + level) * 0.035;
  const endX = x + Math.cos(angle + sway) * length;
  const endY = y + Math.sin(angle + sway) * length;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + Math.cos(angle) * length * 0.52 - 3, y + Math.sin(angle) * length * 0.5, endX, endY);
  ctx.stroke();
  branchCoral(endX, endY, angle - 0.48, length * 0.72, width * 0.68, level - 1, color, time);
  branchCoral(endX, endY, angle + 0.48, length * 0.69, width * 0.65, level - 1, color, time);
  if (level > 2) branchCoral(endX, endY, angle - 0.03, length * 0.55, width * 0.55, level - 2, color, time);
}

function drawKelpAndReef(w, h, time, still, depth) {
  if (depth > 0.86) return;
  const show = clamp(1 - depth * 1.15, 0, 1);
  ctx.save();
  ctx.globalAlpha = show;
  // Rocky shelves along the bottom corners.
  for (let side = 0; side < 2; side++) {
    const x = side === 0 ? 0 : w;
    ctx.fillStyle = '#103e4a';
    ctx.beginPath();
    ctx.moveTo(x, h);
    for (let i = 0; i <= 8; i++) {
      const xx = x + (side === 0 ? 1 : -1) * i * (w * 0.055);
      ctx.lineTo(xx, h - 18 - Math.sin(i * 1.7 + side) * 18);
    }
    ctx.lineTo(x, h);
    ctx.fill();
  }
  // Sea grass blades.
  for (const k of kelp) {
    const sway = still ? 0 : Math.sin(time * 0.001 + k.phase) * 12;
    ctx.strokeStyle = k.color;
    ctx.lineWidth = k.width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(k.x, h + 4);
    ctx.bezierCurveTo(k.x - 18 + sway * 0.3, h - k.height * 0.3, k.x + 14 + sway, h - k.height * 0.72, k.x + sway, h - k.height);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(172,255,199,0.2)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(k.x, h - 5);
    ctx.quadraticCurveTo(k.x + sway * 0.5, h - k.height * 0.5, k.x + sway, h - k.height);
    ctx.stroke();
  }
  // Branching coral fans, all vector paths.
  const coralSpots = [
    [w * 0.035, h, 56, reefColors[0]], [w * 0.13, h + 4, 38, reefColors[2]],
    [w * 0.88, h + 2, 48, reefColors[1]], [w * 0.97, h, 63, reefColors[3]],
  ];
  for (const [x, y, length, color] of coralSpots) {
    branchCoral(x, y, -Math.PI / 2, length, 5, 4, color, time);
    ctx.fillStyle = color;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(x + (i - 2) * 8, y - 5 - (i % 2) * 4, 4 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawJellyfish(x, y, scale, time, color, still) {
  ctx.save();
  ctx.translate(x, y + (still ? 0 : Math.sin(time * 0.0008 + x) * 8));
  ctx.scale(scale, scale);
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  const dome = ctx.createRadialGradient(-10, -15, 2, 0, 0, 36);
  dome.addColorStop(0, 'rgba(231,255,255,0.9)');
  dome.addColorStop(0.42, color);
  dome.addColorStop(1, 'rgba(74,121,216,0.12)');
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.moveTo(-31, 5);
  ctx.bezierCurveTo(-37, -34, 33, -43, 31, 5);
  ctx.quadraticCurveTo(0, 22, -31, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(221,255,255,0.72)';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 6; i++) {
    const tx = -23 + i * 9;
    const wave = still ? 0 : Math.sin(time * 0.003 + i) * 6;
    ctx.beginPath();
    ctx.moveTo(tx, 7);
    ctx.bezierCurveTo(tx - 8 + wave, 25, tx + 9 - wave, 38, tx + wave, 60 + (i % 3) * 8);
    ctx.stroke();
  }
  ctx.fillStyle = '#e9ffff';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(-10 + i * 10, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDeepLife(w, h, time, still, depth) {
  if (depth < 0.36) return;
  const count = depth > 0.72 ? 5 : 3;
  for (let i = 0; i < count; i++) {
    const x = (w * (0.13 + i * 0.22) + Math.sin(time * 0.00012 + i * 2) * 48 + w) % w;
    const y = h * (0.22 + (i % 3) * 0.2) + Math.sin(time * 0.0002 + i) * 18;
    drawJellyfish(x, y, 0.5 + (i % 3) * 0.18, time, i % 2 ? 'rgba(133,111,255,0.45)' : 'rgba(84,233,230,0.48)', still);
  }
  if (depth > 0.68) {
    // Glowing lures drift through the abyss.
    for (let i = 0; i < 7; i++) {
      const x = (i * w / 7 + Math.sin(time * 0.0003 + i) * 28) % w;
      const y = h * (0.18 + (i % 4) * 0.18);
      const glow = ctx.createRadialGradient(x, y, 1, x, y, 17);
      glow.addColorStop(0, 'rgba(177,255,137,0.8)');
      glow.addColorStop(1, 'rgba(104,240,177,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawDiver(w, h, time, still, depth) {
  const x = w * 0.51 + (still ? 0 : Math.sin(time * 0.00032) * w * 0.035);
  const y = h * 0.72 + (still ? 0 : Math.cos(time * 0.0008) * 8);
  const scale = clamp(w / 1150, 0.65, 1.05);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = 0.78;
  // Bubbles leaving the regulator.
  if (!still) {
    for (let i = 0; i < 3; i++) drawBubble(20 + i * 8, -35 - ((time * 0.03 + i * 17) % 42), 2.5 + i * 0.6, 0.7);
  }
  // Fins and legs.
  ctx.fillStyle = '#102a3c';
  ctx.beginPath();
  ctx.moveTo(-7, 15); ctx.lineTo(22, 25); ctx.lineTo(47, 18); ctx.lineTo(56, 25); ctx.lineTo(23, 36); ctx.lineTo(-4, 27); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-16, 15); ctx.lineTo(-33, 27); ctx.lineTo(-59, 24); ctx.lineTo(-64, 31); ctx.lineTo(-28, 38); ctx.lineTo(-7, 25); ctx.closePath(); ctx.fill();
  // Tank.
  ctx.fillStyle = '#b5d9d5';
  ctx.beginPath(); ctx.roundRect(-23, -16, 15, 44, 6); ctx.fill();
  ctx.fillStyle = '#e2b65f'; ctx.fillRect(-22, -18, 13, 5);
  // Torso and arms.
  ctx.fillStyle = '#e4a95e';
  ctx.beginPath(); ctx.ellipse(0, 0, 22, 13, 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#182e48'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-7, -3); ctx.lineTo(21, -18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, 8); ctx.lineTo(29, 14); ctx.stroke();
  // Head and mask.
  ctx.fillStyle = '#d69a6d';
  ctx.beginPath(); ctx.arc(26, -19, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5ce4ee';
  ctx.beginPath(); ctx.roundRect(20, -25, 17, 9, 3); ctx.fill();
  ctx.strokeStyle = '#d8ffff'; ctx.lineWidth = 1.5; ctx.stroke();
  // Regulator hose and light edge.
  ctx.strokeStyle = '#e3d5aa'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(20, -9, 10, -1.4, 0.7); ctx.stroke();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#62f5ec';
  ctx.shadowColor = '#65f7ed'; ctx.shadowBlur = 28;
  ctx.beginPath(); ctx.ellipse(0, 5, 68, 30, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawFrontPredator(x, y, scale, creature, jaw, time) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.shadowColor = creature.color;
  ctx.shadowBlur = 34;

  // Rear tail fin: seen over the back of the animal as it charges toward the camera.
  ctx.fillStyle = creature.fin;
  ctx.beginPath();
  ctx.moveTo(0, -154); ctx.lineTo(-34, -242); ctx.lineTo(-8, -213);
  ctx.lineTo(0, -268); ctx.lineTo(12, -212); ctx.lineTo(39, -242);
  ctx.lineTo(22, -150); ctx.closePath(); ctx.fill();

  // Pectoral fins, spread wide, with separate lit leading edges.
  ctx.beginPath();
  ctx.moveTo(-55, -30);
  ctx.bezierCurveTo(-111, -50, -171, -92, -226, -105);
  ctx.quadraticCurveTo(-197, -20, -130, 43);
  ctx.quadraticCurveTo(-86, 61, -48, 47);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(55, -30);
  ctx.bezierCurveTo(111, -50, 171, -92, 226, -105);
  ctx.quadraticCurveTo(197, -20, 130, 43);
  ctx.quadraticCurveTo(86, 61, 48, 47);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(226,248,242,0.52)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-60, -26); ctx.quadraticCurveTo(-147, -81, -214, -99); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(60, -26); ctx.quadraticCurveTo(147, -81, 214, -99); ctx.stroke();

  // Main head and shoulders, shaded to give the flat Canvas drawing a rounded 3D form.
  const body = ctx.createLinearGradient(-128, -35, 128, 75);
  body.addColorStop(0, '#233d55');
  body.addColorStop(0.18, creature.fin);
  body.addColorStop(0.38, creature.color);
  body.addColorStop(0.5, '#e1eee8');
  body.addColorStop(0.64, creature.color);
  body.addColorStop(0.84, creature.fin);
  body.addColorStop(1, '#172e45');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -205);
  ctx.bezierCurveTo(-72, -157, -121, -85, -117, -12);
  ctx.bezierCurveTo(-115, 50, -83, 105, -37, 126);
  ctx.quadraticCurveTo(0, 145, 37, 126);
  ctx.bezierCurveTo(83, 105, 115, 50, 117, -12);
  ctx.bezierCurveTo(121, -85, 72, -157, 0, -205);
  ctx.closePath(); ctx.fill();

  // Back ridge and dorsal fin silhouette.
  ctx.fillStyle = creature.fin;
  ctx.beginPath();
  ctx.moveTo(-36, -135); ctx.quadraticCurveTo(-12, -185, 0, -224);
  ctx.quadraticCurveTo(17, -185, 37, -135); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(224,246,238,0.34)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -202); ctx.quadraticCurveTo(-18, -158, -21, -111); ctx.stroke();

  // Species details: hammerhead brow, tiger marks, eel-like side ridges or a glowing lure.
  if (creature.shape === 'hammer') {
    ctx.fillStyle = creature.color;
    ctx.beginPath(); ctx.roundRect(-130, -39, 260, 58, 27); ctx.fill();
    ctx.fillStyle = creature.fin;
    ctx.beginPath(); ctx.ellipse(-120, -8, 15, 23, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(120, -8, 15, 23, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (creature.shape === 'tiger') {
    ctx.save();
    ctx.strokeStyle = 'rgba(12,31,45,0.58)';
    ctx.lineWidth = 9;
    for (let i = 0; i < 7; i++) {
      const xx = -82 + i * 27;
      ctx.beginPath();
      ctx.moveTo(xx, -92); ctx.quadraticCurveTo(xx - 16, -18, xx + 1, 43);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (creature.shape === 'angler') {
    ctx.strokeStyle = '#b4ff79'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(0, -136); ctx.quadraticCurveTo(35, -230, 66, -218); ctx.stroke();
    const lure = ctx.createRadialGradient(66, -218, 2, 66, -218, 36);
    lure.addColorStop(0, 'rgba(239,255,174,1)');
    lure.addColorStop(0.32, 'rgba(154,255,113,0.78)');
    lure.addColorStop(1, 'rgba(118,255,107,0)');
    ctx.fillStyle = lure; ctx.beginPath(); ctx.arc(66, -218, 36, 0, Math.PI * 2); ctx.fill();
  }
  if (creature.shape === 'saw') {
    ctx.fillStyle = creature.color;
    ctx.beginPath(); ctx.moveTo(-18, 80); ctx.lineTo(-11, 174);
    for (let i = 0; i < 11; i++) {
      const yy = 82 + i * 8;
      ctx.lineTo(i % 2 ? 13 : -13, yy);
    }
    ctx.lineTo(18, 80); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f5fff0';
    for (let i = 0; i < 10; i++) {
      const yy = 91 + i * 8;
      ctx.fillRect(-16, yy, 8, 4); ctx.fillRect(8, yy, 8, 4);
    }
  }

  // Gill slits on both sides of the face.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(13,34,48,0.66)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 5; i++) {
    const yy = -22 + i * 13;
    ctx.beginPath(); ctx.moveTo(-77 - i * 2, yy - 10); ctx.quadraticCurveTo(-92 - i * 2, yy, -77 - i * 2, yy + 11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(77 + i * 2, yy - 10); ctx.quadraticCurveTo(92 + i * 2, yy, 77 + i * 2, yy + 11); ctx.stroke();
  }

  // Eye sockets, pupils and hard highlights look directly at the player.
  for (const side of [-1, 1]) {
    ctx.fillStyle = 'rgba(3,16,28,0.78)';
    ctx.beginPath(); ctx.ellipse(side * 69, -48, 18, 15, side * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = creature.eye;
    ctx.beginPath(); ctx.arc(side * 69, -48, 9.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f4ffff';
    ctx.beginPath(); ctx.arc(side * 72, -52, 3.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0a1721';
    ctx.beginPath(); ctx.ellipse(side * 69, -48, 2.4, 7.1, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Nose pores / nostrils.
  ctx.fillStyle = 'rgba(9,28,40,0.72)';
  ctx.beginPath(); ctx.ellipse(-24, 13, 7, 3.5, -0.18, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(24, 13, 7, 3.5, 0.18, 0, Math.PI * 2); ctx.fill();

  // Lower jaw moves down as the predator opens its mouth.
  ctx.save();
  ctx.translate(0, jaw * 38);
  const jawShade = ctx.createLinearGradient(0, 54, 0, 142);
  jawShade.addColorStop(0, '#b8ccd0');
  jawShade.addColorStop(0.5, creature.color);
  jawShade.addColorStop(1, creature.fin);
  ctx.fillStyle = jawShade;
  ctx.beginPath();
  ctx.moveTo(-75, 53);
  ctx.quadraticCurveTo(0, 90, 75, 53);
  ctx.quadraticCurveTo(59, 135, 0, 144);
  ctx.quadraticCurveTo(-59, 135, -75, 53);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // Wide black mouth cavity, gum line and two rows of individually drawn teeth.
  ctx.fillStyle = '#180c17';
  ctx.beginPath();
  ctx.moveTo(-78, 43);
  ctx.quadraticCurveTo(0, 30 - jaw * 20, 78, 43);
  ctx.quadraticCurveTo(60, 72 + jaw * 39, 0, 76 + jaw * 42);
  ctx.quadraticCurveTo(-60, 72 + jaw * 39, -78, 43);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#8f4550'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-76, 45); ctx.quadraticCurveTo(0, 29 - jaw * 20, 76, 45); ctx.stroke();
  ctx.fillStyle = '#fff3da';
  for (let i = 0; i < 11; i++) {
    const tx = -67 + i * 13.4;
    const ty = 42 + Math.abs(tx) * 0.05;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + 6, ty + 7 + jaw * 10); ctx.lineTo(tx + 12, ty + 1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx, 75 + jaw * 39); ctx.lineTo(tx + 6, 65 + jaw * 28); ctx.lineTo(tx + 12, 76 + jaw * 39); ctx.closePath(); ctx.fill();
  }

  // Bright wet highlights on the snout and chin.
  ctx.strokeStyle = 'rgba(235,255,249,0.38)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 32, 92, 0.18, Math.PI - 0.18); ctx.stroke();
  ctx.restore();
}

function drawAttackWake(w, h, cx, cy, progress) {
  // Perspective streaks and pressure rings radiate from the approaching animal.
  ctx.save();
  ctx.globalAlpha = 0.08 + progress * 0.13;
  ctx.strokeStyle = '#b6fff6';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 30; i++) {
    const angle = i * Math.PI * 2 / 30;
    const inner = 26 + progress * 54;
    const outer = Math.max(w, h) * (0.35 + progress * 0.45);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const radius = 38 + progress * (70 + i * 42);
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 1.2, radius * 0.54, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAttack(w, h, time, still) {
  if (!predator) return;
  const elapsed = time - predator.start;
  if (elapsed >= predator.duration) { predator = null; return; }
  const progress = still ? 0.72 : clamp(elapsed / predator.duration, 0, 1);
  const creature = species[predator.species];
  const approach = clamp(progress / 0.88, 0, 1);
  const eased = 1 - Math.pow(1 - approach, 2.35);
  const maxScale = clamp(w / 190, 2.05, 6.8);
  const scale = mix(0.055, maxScale, eased);
  const x = w * 0.5 + Math.sin(time * 0.004) * (1 - eased) * w * 0.018;
  const y = mix(h * 0.37, h * 0.51, eased);
  const jaw = clamp((progress - 0.2) / 0.32, 0, 1);
  const fade = progress > 0.94 ? (1 - progress) / 0.06 : 1;

  drawAttackWake(w, h, x, y, progress);
  const glow = ctx.createRadialGradient(x, y, 4, x, y, Math.max(w, h) * (0.12 + eased * 0.65));
  glow.addColorStop(0, 'rgba(187,255,242,' + (0.08 + eased * 0.14) + ')');
  glow.addColorStop(0.45, 'rgba(83,220,236,' + (0.035 + eased * 0.045) + ')');
  glow.addColorStop(1, 'rgba(40,115,180,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = clamp(fade, 0, 1);
  drawFrontPredator(x, y, scale, creature, jaw, time);
  ctx.restore();

  // The last instant is a wall of bubbles rushing past the diver.
  if (progress > 0.72) {
    const burst = clamp((progress - 0.72) / 0.28, 0, 1);
    ctx.save();
    ctx.globalAlpha = 1 - burst * 0.36;
    for (let i = 0; i < 48; i++) {
      const angle = i * Math.PI * 2 / 48;
      const radius = 22 + burst * (125 + (i % 5) * 24);
      drawBubble(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * 0.62,
        2.5 + (i % 5) * 1.1, 0.72 * (1 - burst * 0.25));
    }
    ctx.restore();
  }
}

function frame(time) {
  if (threeDActive || !ctx || !canvas) return;
  const w = innerWidth, h = innerHeight;
  const depth = clamp((Number(getDepth()) || 0) / CONFIG.MAX_DEPTH_VISUAL, 0, 1);
  const still = Boolean(isStill());
  const delta = still ? 0 : Math.min(40, lastFrame ? time - lastFrame : 16);
  const t = still ? (lastFrame || time) : time;
  lastFrame = t;

  drawWater(w, h, depth, t);
  drawKelpAndReef(w, h, t, still, depth);
  drawFishSchools(w, h, t, still, depth, delta);
  drawDeepLife(w, h, t, still, depth);
  drawAmbient(w, h, t, still, depth);
  drawDiver(w, h, t, still, depth);
  // Clear and render the short predator sequence above the interface.
  attackCtx.clearRect(0, 0, w, h);
  const previousCtx = ctx;
  ctx = attackCtx;
  drawAttack(w, h, time, still);
  ctx = previousCtx;

  requestAnimationFrame(frame);
}
