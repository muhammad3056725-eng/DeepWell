// DOM helpers and screen renderers. No game rules live here.
import { CONFIG, sinkMetres } from './config.js?v=linked-20261125';
import { CATEGORIES } from './catalog.js?v=linked-20261125';
import { libraryStats } from './data.js?v=linked-20261125';
import { tierClass, utcDate } from './engine.js?v=linked-20261125';
import * as S from './state.js?v=linked-20261125';
import { setVolume } from './audio.js?v=linked-20261125';

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
let depthAnimation = 0;
let displayedDepth = 0;
export function toast(text) {
  const el = $('toast');
  el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function show(id) {
  document.querySelectorAll('.screen').forEach(x => x.classList.toggle('active', x.id === id));
  if (id === 'stats') renderStats();
  if (id === 'settings') loadSettingsUI();
  if (id === 'home') renderHome();
  window.scrollTo(0, 0);
}

const DEPTH_ZONES = [
  {key:'sunlight',label:'Sunlight zone',end:400},
  {key:'twilight',label:'Twilight zone',end:1500},
  {key:'midnight',label:'Midnight zone',end:3500},
  {key:'abyss',label:'Abyss',end:7000},
];

export function updateDepthUI(depth, ms = 340) {
  const d = Math.max(0,Math.round(Number(depth)||0));
  const readout = $('topDepth');
  if(depthAnimation) cancelAnimationFrame(depthAnimation);
  const from=displayedDepth,started=performance.now();
  const duration=S.store.settings.motion?0:ms;
  const paint=now=>{
    const t=duration?Math.min(1,(now-started)/duration):1;
    const eased=1-Math.pow(1-t,3);
    displayedDepth=Math.round(from+(d-from)*eased);
    if(readout)readout.textContent=`${displayedDepth.toLocaleString()} m below`;
    if(t<1)depthAnimation=requestAnimationFrame(paint);
    else {displayedDepth=d;depthAnimation=0;}
  };
  paint(performance.now());
  const zone = DEPTH_ZONES.find(z => d < z.end) || DEPTH_ZONES[DEPTH_ZONES.length-1];
  const zoneReadout = $('zoneLabel');
  if(zoneReadout) zoneReadout.textContent = zone.label;
  document.body.dataset.zone = zone.key;
  const marker = $('depthMarker');
  if(marker) marker.style.top = `${Math.min(100,d/7000*100)}%`;
  const gaugeValue = $('depthGaugeValue');
  if(gaugeValue) gaugeValue.textContent = `${d.toLocaleString()} m`;
}

function untilReset() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const mins = Math.max(1, Math.round((next - now.getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function renderHome() {
  const today = S.store.dailyLog[utcDate()];
  $('dailyBtn').textContent = today ? `Completed · ${today.depth} m` : 'Daily Dive';
  $('countdown').textContent = `Next daily in ${untilReset()} · ${today ? 'come back tomorrow' : 'a fresh descent awaits'}`;
  const st = libraryStats();
  $('library').textContent = st.packs
    ? `${st.answers.toLocaleString()} saved answers · ${st.packs.toLocaleString()} offline packs · ${st.prompts.toLocaleString()} question prompts · updated ${st.built}`
    : `Starter set: ${st.stable} offline-ready prompts · ${st.prompts.toLocaleString()} question prompts available for live Endless play.`;
}

export function renderStats() {
  const s = S.store;
  const avg = s.games ? Math.round(s.total / s.games) : 0;
  const today = s.dailyLog[utcDate()];
  const cells = [
    ['Dives', s.games], ['Daily streak', S.liveStreak() + ' days'], ['Best streak', s.bestStreak + ' days'],
    ['Best depth', s.best + ' m'], ['Average depth', avg + ' m'], ['Daily status', today ? `Done · ${today.depth} m` : 'Ready'],
    ['Unrecognised answers', s.misses],
  ];
  $('statsList').innerHTML = cells.map(([k, v]) => `<div><div class="stat-label">${esc(k)}</div><strong>${esc(v)}</strong></div>`).join('');
}

export function renderResults(run, streak) {
  const hits = run.answers.filter(a => a.points > 0).length;
  $('resultScore').textContent = Math.round(run.depth) + ' m';
  $('resultHeading').textContent = run.mode === 'daily' ? 'Daily dive complete.' : 'The well remembers.';
  $('resultCopy').textContent = run.depth > 4000 ? 'The trench lights answer back.'
    : run.depth > 2000 ? 'The water is turning black. Keep thinking sideways.'
    : 'A good first descent. The deep answers are still down there.';
  $('resultStreak').textContent = streak + ' day' + (streak === 1 ? '' : 's');
  $('resultBest').textContent = S.store.best + ' m';
  $('resultAnswers').textContent = `${hits} / ${CONFIG.PROMPTS_PER_DIVE}`;
  $('diveLog').innerHTML = diveLogSvg(run);
  $('breakdown').innerHTML = run.answers.map((a, i) => {
    const hint = a.points < 40 && a.examples
      ? `<small>${a.state === 'hit' ? 'Deeper options' : 'You could have said'}: ${[...a.examples.famous.slice(0, a.state === 'hit' ? 0 : 2), a.examples.rare].filter(Boolean).map(esc).join(', ')}</small>`
      : '';
    const label = a.points ? `+${a.points} ${esc(a.tier)}` : (a.state === 'repeat' ? '0 · Repeat' : '0 · Miss');
    const cls = a.points ? tierClass(a.tier) : '';
    return `<div class="row ${a.points ? '' : 'miss'}"><div class="q">${i + 1}. ${esc(a.prompt)}</div><span>${esc(a.name || a.input)}${a.name && a.name.toLowerCase() !== a.input.toLowerCase() ? ` <small>(you typed “${esc(a.input)}”)</small>` : ''}</span><strong class="${cls}">${label}</strong>${hint}</div>`;
  }).join('');
}

export function buildPackButtons(onPick) {
  const box = $('packActions');
  box.innerHTML = '';
  for (const cat of CATEGORIES) {
    const b = document.createElement('button');
    b.className = 'button'; b.textContent = cat;
    b.onclick = () => onPick(cat);
    box.appendChild(b);
  }
}

export function applySettings() {
  const s = S.store.settings;
  document.documentElement.style.fontSize = 16 * s.text + 'px';
  document.body.classList.toggle('reduced', Boolean(s.motion));
  document.body.classList.toggle('colorsafe', Boolean(s.color));
  setVolume(s.sound);
  const graphics = s.graphics || 'auto';
  document.body.classList.remove('quality-low','quality-med','quality-high','quality-auto');
  document.body.classList.add(graphics === 'low' ? 'quality-low' : graphics === 'medium' ? 'quality-med' : graphics === 'high' ? 'quality-high' : 'quality-auto');
  document.body.dataset.graphics = graphics;
}

export function loadSettingsUI() {
  const s = S.store.settings;
  $('soundSetting').value = s.sound; $('hapticSetting').checked = s.haptics;
  $('motionSetting').checked = s.motion; $('colorSetting').checked = s.color;
  $('timerSetting').value = String(s.timer); $('textSetting').value = String(s.text); $('graphicsSetting').value = s.graphics || 'auto';
}

export function readSettingsUI() {
  const s = S.store.settings;
  s.sound = Number($('soundSetting').value); s.haptics = $('hapticSetting').checked;
  s.motion = $('motionSetting').checked; s.color = $('colorSetting').checked;
  s.timer = Number($('timerSetting').value); s.text = Number($('textSetting').value); s.graphics = $('graphicsSetting')?.value || s.graphics || 'auto';
  applySettings(); S.save();
}

/** Vertical drop chart: one line per prompt falling as far as its points earned, ending in a glowing orb in the tier colour. */
function diveLogSvg(run) {
  const n = CONFIG.PROMPTS_PER_DIVE, W = 320, H = 150, top = 20, bottom = 24, left = 54, right = 12;
  const plotH = H - top - bottom, gap = (W - left - right) / n, metres = p => sinkMetres(p);
  // The scale adapts to the dive (at least 40 points tall) so even a run of common answers draws a readable drop.
  const scalePts = Math.max(40, Math.ceil(Math.max(0, ...run.answers.map(a => a.points)) * 1.15)), maxM = metres(scalePts), ticks = [0, 0.5, 1];
  let g = '';
  for (const t of ticks) {
    const y = top + t * plotH;
    g += `<line x1="${left - 6}" x2="${W - right}" y1="${y}" y2="${y}" class="dl-grid"/><text x="${left - 10}" y="${y + 3}" class="dl-axis" text-anchor="end">${t === 0 ? '0 m' : '-' + Math.round(maxM * t) + ' m'}</text>`;
  }
  for (let i = 0; i < n; i++) {
    const a = run.answers[i], x = left + gap * (i + 0.5);
    g += `<text x="${x}" y="${H - 9}" class="dl-axis" text-anchor="middle">P${i + 1}</text>`;
    if (!a) continue;
    if (!a.points) { g += `<circle cx="${x}" cy="${top}" r="5" class="dl-miss"/>`; continue; }
    const y = top + Math.min(1, a.points / scalePts) * plotH;
    g += `<g class="${tierClass(a.tier)}"><line x1="${x}" x2="${x}" y1="${top}" y2="${y}" class="dl-drop"/><circle cx="${x}" cy="${y}" r="9" class="dl-halo"/><circle cx="${x}" cy="${y}" r="4.5" class="dl-orb"/></g>`;
  }
  return `<div class="stat-label">Dive log · deeper = rarer</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Depth reached by each of your answers">${g}</svg>`;
}
