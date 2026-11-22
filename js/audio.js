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


// Short synthesized effects for the visual encounters. They share the existing
// Sound setting and require no downloaded audio assets.
function sweepTone(startHz,endHz,duration,peak,type='sine',delay=0) {
  if(!ctx||!volume)return;
  const now=ctx.currentTime+delay;
  const osc=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
  osc.type=type;
  osc.frequency.setValueAtTime(startHz,now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1,endHz),now+duration);
  filter.type='lowpass';filter.frequency.setValueAtTime(900,now);
  filter.frequency.exponentialRampToValueAtTime(170,now+duration);
  gain.gain.setValueAtTime(0.0001,now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002,peak*volume),now+0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001,now+duration);
  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(now);osc.stop(now+duration+0.035);
}

export function predatorGulp() {
  if(!ctx||!volume)return;
  sweepTone(118,38,0.48,0.22,'sawtooth');
  sweepTone(430,92,0.34,0.075,'sine',0.12);
  sweepTone(620,210,0.18,0.035,'triangle',0.22);
}

export function rareSparkle() {
  if(!ctx||!volume)return;
  sweepTone(660,920,0.18,0.045,'sine');
  sweepTone(880,1320,0.22,0.04,'triangle',0.08);
  sweepTone(1180,1760,0.24,0.03,'sine',0.17);
}
