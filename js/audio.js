// Tiny WebAudio blips. Silent until the first user gesture.
let ctx = null;
let volume = 0.45;

export const setVolume = v => { volume = v; };

export function wake() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* no audio */ }
}

export function tone(freq, duration = 0.12, type = 'sine') {
  if (!ctx || !volume) return;
  const now = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.08 * volume, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  o.connect(g).connect(ctx.destination);
  o.start(now); o.stop(now + duration + 0.02);
}

export function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
}
