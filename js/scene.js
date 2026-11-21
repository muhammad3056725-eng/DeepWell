// Background canvas: the water column. Depth darkens it; the diver drifts.
import { CONFIG } from './config.js';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
let particles = [];
let getDepth = () => 0;
let isStill = () => false;

export function startScene(depthFn, stillFn) {
  getDepth = depthFn; isStill = stillFn;
  resize();
  addEventListener('resize', resize);
  requestAnimationFrame(frame);
}

function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  particles = Array.from({ length: Math.min(100, Math.floor(innerWidth / 8)) }, () => ({
    x: Math.random() * innerWidth, y: Math.random() * innerHeight,
    r: Math.random() * 2 + 0.3, s: Math.random() * 0.35 + 0.08, a: Math.random() * 0.65 + 0.1,
  }));
}

function frame(time) {
  const w = innerWidth, h = innerHeight;
  const depth = Math.min(1, getDepth() / CONFIG.MAX_DEPTH_VISUAL);
  const still = isStill();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgb(${Math.round(10 - 7 * depth)},${Math.round(53 - 34 * depth)},${Math.round(72 - 42 * depth)})`);
  g.addColorStop(0.52, `rgb(${Math.round(5 - 3 * depth)},${Math.round(27 - 18 * depth)},${Math.round(43 - 25 * depth)})`);
  g.addColorStop(1, '#02070e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  ctx.save(); ctx.globalAlpha = 0.13; ctx.strokeStyle = '#6be4ed';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(-20, h * 0.2 + i * 38);
    ctx.quadraticCurveTo(w * 0.4, h * 0.1 + i * 48, w + 20, h * 0.27 + i * 36); ctx.stroke();
  }
  ctx.restore();

  for (const p of particles) {
    if (!still) { p.y += p.s; if (p.y > h + 5) p.y = -5; }
    ctx.fillStyle = `rgba(174,235,231,${p.a * (0.5 + depth)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }

  const sway = still ? 0 : Math.sin(time / 3000) * w * 0.06;
  const bob = still ? 0 : Math.cos(time / 2400) * 16;
  ctx.save(); ctx.translate(w * 0.5 + sway, h * 0.6 + bob);
  ctx.globalAlpha = 0.18; ctx.fillStyle = '#82edf1'; ctx.shadowBlur = 35; ctx.shadowColor = '#36dbe7';
  ctx.beginPath(); ctx.ellipse(0, 0, 44, 13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.8; ctx.shadowBlur = 10; ctx.fillStyle = '#d5ffff';
  ctx.beginPath(); ctx.moveTo(-28, 0); ctx.lineTo(22, -12); ctx.lineTo(39, 0); ctx.lineTo(22, 12); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#116879'; ctx.beginPath(); ctx.arc(4, 0, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  requestAnimationFrame(frame);
}
