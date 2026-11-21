// Procedural underwater world for DEEPWELL.
// All creatures, scenery, lighting and attack effects are drawn at runtime with Canvas 2D.
// No image, video, sprite, texture or external visual assets are used.
import { CONFIG } from './config.js';

const canvas = document.getElementById('scene');
const ctx = canvas?.getContext('2d', { alpha: false });
let getDepth = () => 0;
let isStill = () => false;
let bubbles = [];
let fish = [];
let kelp = [];
let lastSpecies = -1;
let predator = null;
let lastFrame = 0;

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
  resize();
  addEventListener('resize', resize, { passive: true });
  requestAnimationFrame(frame);
}

// Called only by the answer-resolution path. It changes visuals only; no game state.
export function triggerPredatorAttack() {
  let pick = Math.floor(Math.random() * species.length);
  if (species.length > 1 && pick === lastSpecies) pick = (pick + 1 + Math.floor(Math.random() * (species.length - 1))) % species.length;
  lastSpecies = pick;
  predator = {
    species: pick,
    side: Math.random() < 0.5 ? 'left' : 'right',
    start: performance.now(),
    duration: 1850,
  };
}

function resize() {
  if (!canvas || !ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  bubbles = Array.from({ length: Math.min(120, Math.floor(innerWidth / 7)) }, () => ({
    x: rand(0, innerWidth), y: rand(0, innerHeight), r: rand(0.7, 3.1),
    speed: rand(0.18, 0.78), drift: rand(0.3, 1.6), phase: rand(0, Math.PI * 2),
    alpha: rand(0.16, 0.58),
  }));
  fish = Array.from({ length: Math.min(24, Math.max(12, Math.floor(innerWidth / 65))) }, (_, i) => ({
    x: rand(-innerWidth, innerWidth * 1.5), y: rand(innerHeight * 0.12, innerHeight * 0.88),
    size: rand(0.22, 0.78), speed: rand(0.22, 0.8) * (i % 3 === 0 ? 1.4 : 1),
    direction: Math.random() < 0.5 ? -1 : 1, color: fishColors[i % fishColors.length],
    phase: rand(0, Math.PI * 2), depth: rand(0.15, 1),
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

function drawFishSchools(w, h, time, still, depth) {
  for (const f of fish) {
    const visible = f.depth < 0.25 + depth * 1.0;
    if (!still) {
      f.x += f.speed * f.direction * (1 + depth * 0.3);
      f.y += Math.sin(time * 0.00025 + f.phase) * 0.16;
      if (f.direction > 0 && f.x > w + 100) f.x = -100;
      if (f.direction < 0 && f.x < -100) f.x = w + 100;
    }
    if (visible) drawSmallFish(f.x, f.y, f.size, f.color, f.direction, f.phase, time, 0.28 + (1 - depth) * 0.5);
  }
  // A close school makes the reef feel populated rather than like a flat wallpaper.
  if (depth < 0.62) {
    for (let i = 0; i < 9; i++) {
      const x = (w * 0.18 + i * 19 + Math.sin(time * 0.0004) * 34 + w) % (w + 30);
      const y = h * 0.27 + Math.sin(time * 0.001 + i * 0.75) * 21;
      drawSmallFish(x, y, 0.32 + (i % 3) * 0.08, fishColors[(i + 2) % fishColors.length], 1, i, time, 0.66);
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

function drawPredator(x, y, scale, direction, creature, jaw, time) {
  const len = creature.shape === 'long' || creature.shape === 'saw' ? 310 : creature.shape === 'round' ? 245 : 280;
  const ht = creature.shape === 'round' ? 94 : creature.shape === 'eel' ? 54 : 78;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(direction * scale, scale);
  ctx.shadowColor = creature.color;
  ctx.shadowBlur = 28;
  ctx.globalAlpha = 0.98;

  // Tail and rear fins.
  ctx.fillStyle = creature.fin;
  ctx.beginPath();
  ctx.moveTo(-len * 0.36, 0);
  ctx.quadraticCurveTo(-len * 0.48, -ht * 0.18, -len * 0.59, -ht * 0.62);
  ctx.lineTo(-len * 0.52, 0);
  ctx.lineTo(-len * 0.59, ht * 0.62);
  ctx.quadraticCurveTo(-len * 0.48, ht * 0.18, -len * 0.36, 0);
  ctx.fill();
  // Main body silhouette.
  const body = ctx.createLinearGradient(0, -ht * 0.55, 0, ht * 0.55);
  body.addColorStop(0, '#d7e9df');
  body.addColorStop(0.16, creature.color);
  body.addColorStop(1, creature.fin);
  ctx.fillStyle = body;
  ctx.beginPath();
  if (creature.shape === 'eel') {
    ctx.moveTo(-len * 0.44, -ht * 0.12);
    ctx.bezierCurveTo(-len * 0.15, -ht * 0.55, len * 0.2, -ht * 0.5, len * 0.46, -ht * 0.18);
    ctx.quadraticCurveTo(len * 0.57, 0, len * 0.46, ht * 0.18);
    ctx.bezierCurveTo(len * 0.12, ht * 0.53, -len * 0.18, ht * 0.43, -len * 0.44, ht * 0.12);
  } else {
    ctx.moveTo(-len * 0.44, 0);
    ctx.quadraticCurveTo(-len * 0.29, -ht * 0.63, len * 0.1, -ht * 0.46);
    ctx.quadraticCurveTo(len * 0.37, -ht * 0.38, len * 0.49, -ht * 0.08);
    ctx.quadraticCurveTo(len * 0.56, 0, len * 0.49, ht * 0.08);
    ctx.quadraticCurveTo(len * 0.35, ht * 0.4, len * 0.08, ht * 0.43);
    ctx.quadraticCurveTo(-len * 0.3, ht * 0.58, -len * 0.44, 0);
  }
  ctx.closePath();
  ctx.fill();

  // Species-specific silhouettes.
  if (creature.shape === 'hammer') {
    ctx.fillStyle = creature.color;
    ctx.beginPath();
    ctx.roundRect(len * 0.24, -ht * 0.36, len * 0.26, ht * 0.72, 18);
    ctx.fill();
    ctx.fillStyle = creature.eye;
    ctx.beginPath(); ctx.arc(len * 0.27, -ht * 0.15, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(len * 0.48, -ht * 0.15, 5, 0, Math.PI * 2); ctx.fill();
  } else if (creature.shape === 'saw') {
    ctx.fillStyle = creature.color;
    ctx.beginPath();
    ctx.moveTo(len * 0.38, -ht * 0.08);
    ctx.lineTo(len * 0.72, -ht * 0.025);
    for (let i = 0; i < 8; i++) {
      const xx = len * (0.70 - i * 0.04);
      ctx.lineTo(xx, (i % 2 ? -1 : 1) * ht * 0.13);
      ctx.lineTo(xx - len * 0.025, -ht * 0.02);
    }
    ctx.closePath(); ctx.fill();
  } else if (creature.shape !== 'eel') {
    ctx.fillStyle = creature.fin;
    ctx.beginPath();
    ctx.moveTo(-len * 0.14, -ht * 0.34);
    ctx.lineTo(len * 0.02, -ht * (creature.shape === 'angler' ? 0.92 : 0.95));
    ctx.lineTo(len * 0.18, -ht * 0.34);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-len * 0.1, ht * 0.34);
    ctx.lineTo(len * 0.12, ht * 0.77);
    ctx.lineTo(len * 0.27, ht * 0.27);
    ctx.closePath(); ctx.fill();
  }

  // Open jaws, dark mouth cavity and individually drawn teeth.
  const mouthX = len * 0.43;
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#170f1b';
  ctx.beginPath();
  ctx.moveTo(mouthX - 26, -ht * 0.08);
  ctx.quadraticCurveTo(mouthX + 17, -ht * (0.12 + jaw * 0.38), mouthX + 17, 0);
  ctx.quadraticCurveTo(mouthX + 8, ht * (0.05 + jaw * 0.47), mouthX - 25, ht * 0.08);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff3d8';
  for (let i = 0; i < 6; i++) {
    const tx = mouthX - 17 + i * 5;
    ctx.beginPath();
    ctx.moveTo(tx, -ht * 0.06);
    ctx.lineTo(tx + 2.5, -ht * (0.1 + jaw * 0.28));
    ctx.lineTo(tx + 5, -ht * 0.045);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tx, ht * 0.06);
    ctx.lineTo(tx + 2.5, ht * (0.1 + jaw * 0.25));
    ctx.lineTo(tx + 5, ht * 0.045);
    ctx.fill();
  }
  // Eye, gill slits and tiger stripes.
  ctx.fillStyle = creature.eye;
  ctx.beginPath(); ctx.arc(len * 0.32, -ht * 0.18, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f5ffff';
  ctx.beginPath(); ctx.arc(len * 0.335, -ht * 0.2, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(8,29,39,0.58)';
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(len * (0.17 + i * 0.045), -ht * 0.12);
    ctx.quadraticCurveTo(len * (0.14 + i * 0.045), 0, len * (0.17 + i * 0.045), ht * 0.18);
    ctx.stroke();
  }
  if (creature.shape === 'tiger') {
    ctx.strokeStyle = 'rgba(15,34,45,0.55)'; ctx.lineWidth = 4;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(-len * 0.2 + i * 19, -ht * 0.31);
      ctx.lineTo(-len * 0.14 + i * 19, ht * 0.29);
      ctx.stroke();
    }
  }
  if (creature.shape === 'angler') {
    ctx.strokeStyle = '#a9f76f'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(len * 0.12, -ht * 0.34); ctx.quadraticCurveTo(len * 0.26, -ht * 1.18, len * 0.39, -ht * 0.9); ctx.stroke();
    const lure = ctx.createRadialGradient(len * 0.39, -ht * 0.9, 1, len * 0.39, -ht * 0.9, 20);
    lure.addColorStop(0, 'rgba(228,255,138,0.95)'); lure.addColorStop(1, 'rgba(157,255,103,0)');
    ctx.fillStyle = lure; ctx.beginPath(); ctx.arc(len * 0.39, -ht * 0.9, 20, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawAttack(w, h, time, still) {
  if (!predator) return;
  const elapsed = time - predator.start;
  const progress = clamp(elapsed / predator.duration, 0, 1);
  if (progress >= 1) { predator = null; return; }
  const creature = species[predator.species];
  const direction = predator.side === 'left' ? 1 : -1;
  const size = mix(0.62, 1.18, Math.sin(progress * Math.PI));
  const targetX = w * 0.52;
  const startX = predator.side === 'left' ? -360 : w + 360;
  const endX = targetX + (direction === 1 ? 72 : -72);
  const eased = 1 - Math.pow(1 - progress, 2.3);
  const x = mix(startX, endX, eased);
  const y = h * 0.7 + Math.sin(progress * Math.PI * 1.4) * 14;
  const jaw = still ? 0.7 : clamp((progress - 0.42) / 0.23, 0, 1);
  const fade = progress > 0.84 ? (1 - progress) / 0.16 : 1;

  ctx.save();
  ctx.globalAlpha = clamp(fade, 0, 1);
  drawPredator(x, y, size, direction, creature, jaw, time);
  ctx.restore();

  // A ring of hand-drawn bubbles marks the swallow; it is not a video overlay.
  if (progress > 0.72) {
    const burst = clamp((progress - 0.72) / 0.28, 0, 1);
    ctx.save();
    ctx.globalAlpha = 1 - burst * 0.5;
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI * 2 / 24;
      const radius = 16 + burst * (95 + (i % 4) * 14);
      drawBubble(targetX + Math.cos(angle) * radius, y + Math.sin(angle) * radius * 0.55, 2 + (i % 4), 0.72 * (1 - burst * 0.35));
    }
    ctx.restore();
  }
}

function frame(time) {
  if (!ctx || !canvas) return;
  const w = innerWidth, h = innerHeight;
  const depth = clamp((Number(getDepth()) || 0) / CONFIG.MAX_DEPTH_VISUAL, 0, 1);
  const still = Boolean(isStill());
  const t = still ? (lastFrame || time) : time;
  lastFrame = t;

  drawWater(w, h, depth, t);
  drawKelpAndReef(w, h, t, still, depth);
  drawFishSchools(w, h, t, still, depth);
  drawDeepLife(w, h, t, still, depth);
  drawAmbient(w, h, t, still, depth);
  drawDiver(w, h, t, still, depth);
  drawAttack(w, h, time, still);

  requestAnimationFrame(frame);
}
