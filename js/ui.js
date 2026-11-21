// DOM helpers and screen renderers. No game rules live here.
import { CONFIG } from './config.js?v=answer-expansion-20261121';
import { CATEGORIES } from './catalog.js?v=answer-expansion-20261121';
import { libraryStats } from './data.js?v=answer-expansion-20261121';
import { tierClass, utcDate } from './engine.js?v=answer-expansion-20261121';
import * as S from './state.js';
import { setVolume } from './audio.js';

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
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

export function updateDepthUI(depth) {
  const d = Math.round(depth);
  const readout = $('topDepth');
  if (readout) readout.textContent = `${d.toLocaleString()} m below`;
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
    ? `${st.answers.toLocaleString()} answers from Wikidata · ${st.prompts} question types · updated ${st.built}`
    : `Starter set: ${st.stable} question types ready. Full Wikidata library loads after the first data build.`;
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
}

export function loadSettingsUI() {
  const s = S.store.settings;
  $('soundSetting').value = s.sound; $('hapticSetting').checked = s.haptics;
  $('motionSetting').checked = s.motion; $('colorSetting').checked = s.color;
  $('timerSetting').value = String(s.timer); $('textSetting').value = String(s.text);
}

export function readSettingsUI() {
  const s = S.store.settings;
  s.sound = Number($('soundSetting').value); s.haptics = $('hapticSetting').checked;
  s.motion = $('motionSetting').checked; s.color = $('colorSetting').checked;
  s.timer = Number($('timerSetting').value); s.text = Number($('textSetting').value);
  applySettings(); S.save();
}
