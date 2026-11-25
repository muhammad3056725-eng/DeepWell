// DEEPWELL entry point: wires the screens to the game rules.
import { CONFIG } from './config.js?v=linked-20261125';
import { matchAnswer, tier, tierClass, blendPoints, utcDate } from './engine.js?v=linked-20261125';
import { loadManifest } from './data.js?v=linked-20261125';
import { prepareDive, examples } from './game.js?v=linked-20261125';
import { crowdEnabled, crowdStats, crowdSubmit } from './crowd.js';
import * as S from './state.js?v=linked-20261125';
import { startScene, triggerAnswerVisual, resetDiveVisual } from './scene.js?v=linked-20261125';
import { wake, tone, buzz } from './audio.js?v=linked-20261125';
import {
  $, show, toast, updateDepthUI, renderHome, renderResults,
  buildPackButtons, applySettings, readSettingsUI,
} from './ui.js?v=linked-20261125';

let run = null; // the dive in progress
let timerRaf = 0;
let lastTimerPaint = -1;
let runId = 0;  // guards against a stale async load finishing after the player left

const SOURCE_LABEL = { wikidata: 'Wikidata', seed: 'Offline list', live: 'Live Wikidata' };

/* ---------------------------------------------------------------- starting */
async function startDive(mode, category = null) {
  wake();
  if (mode === 'daily' && S.dailyDone()) { toast("Today's dive is already in your logbook."); return; }
  const id = ++runId;
  resetDiveVisual();
  clearInterval(run?.timer);
  run = null;
  show('game');
  document.body.classList.add('in-game');
  $('roundLabel').textContent = 'LOADING';
  $('modeLabel').textContent = label(mode, category);
  $('srcBadge').textContent = '';
  $('promptText').innerHTML = '<span class="loading">Finding questions…</span>';
  $('feedback').textContent = '';
  $('timerBar').style.transform = 'scaleX(1)';
  $('answerInput').disabled = true; $('submitBtn').disabled = true;
  updateDepthUI(0);

  let prompts;
  try {
    prompts = await prepareDive({ mode, category, recent: S.store.recentPrompts });
  } catch (e) {
    if (id !== runId) return;
    toast(e.message || 'Could not start a dive.');
    show('home');
    document.body.classList.remove('in-game');
    return;
  }
  if (id !== runId) return;
  S.rememberPrompts(prompts.flatMap(p => [p.entry.id, `question:${p.text.toLowerCase().replace(/\\s+/g, ' ').trim()}`]));
  run = { spares: prompts.spares || [], swapsLeft: 1, mode, category, prompts, index: 0, depth: 0, answers: [], used: new Set(), remaining: 0, locked: false, paused: false, timer: null, pending: null, id };
  $('answerInput').disabled = false; $('submitBtn').disabled = false;
  nextPrompt();
}

const label = (mode, cat) => (mode === 'daily' ? 'DAILY DIVE' : mode === 'pack' ? String(cat).toUpperCase() : 'ENDLESS DIVE');

function nextPrompt() {
  if (run.index >= run.prompts.length) return finish();
  const p = run.prompts[run.index];
  run.locked = false; run.paused = false; run.pending = null; run.tries = [];
  $('confirmBox').classList.remove('show');
  $('roundLabel').textContent = `PROMPT ${run.index + 1} / ${run.prompts.length}`;
  const badge = $('srcBadge');
  badge.textContent = SOURCE_LABEL[p.source] || '';
  badge.className = 'src-badge ' + (p.source === 'live' ? 'live' : p.source === 'seed' ? 'seed' : '');
  $('promptText').textContent = p.text;
  $('feedback').textContent = '';
  updateSwapUI();
  paintSteps();
  const input = $('answerInput');
  input.value = ''; input.disabled = false; $('submitBtn').disabled = false; input.focus();
  startTimer();
}

/* ---------------------------------------------------------- swap lifeline */
function updateSwapUI() {
  const btn = $('swapBtn'); if (!btn || !run) return;
  const left = run.swapsLeft > 0 && run.spares.length > 0 ? run.swapsLeft : 0;
  $('swapLeft').textContent = String(left);
  btn.disabled = left === 0 || run.locked;
}

/** Throw away the current question for a fresh one of the same difficulty (once per dive). The timer restarts. */
function swapPrompt() {
  if (!run || run.locked || run.paused || run.swapsLeft < 1 || !run.spares.length) return;
  const current = run.prompts[run.index];
  const at = run.spares.findIndex(p => p.level === current.level);
  const [spare] = run.spares.splice(at >= 0 ? at : 0, 1);
  run.swapsLeft--; run.swapUsed = true;
  run.prompts[run.index] = spare;
  S.rememberPrompts([spare.entry.id, `question:${spare.text.toLowerCase().replace(/\s+/g, ' ').trim()}`]);
  toast('Swapped: new question');
  nextPrompt();
}

/* ------------------------------------------------------------------- timer */
function startTimer() {
  clearInterval(run.timer);
  if (timerRaf) cancelAnimationFrame(timerRaf);
  const seconds = run.mode === 'daily' ? CONFIG.DAILY_SECONDS : S.store.settings.timer;
  run.total = seconds * 1000; run.remaining = run.total;
  const bar = $('timerBar');
  lastTimerPaint = -1;
  bar.style.transform = 'scaleX(1)';
  bar.dataset.timerColor = '';
  let last = performance.now(), lastSec = seconds;
  const mine = run;
  const tick = now => {
    if (run !== mine || document.hidden) { timerRaf = 0; return; }
    const dt = Math.min(100, now - last); last = now;
    if (!run.paused && !run.locked) {
      run.remaining = Math.max(0, run.remaining - dt);
      const ratio = run.remaining / run.total;
      const pct = Math.round(ratio * 200);
      if (pct !== lastTimerPaint) {
        bar.style.transform = `scaleX(${ratio})`;
        lastTimerPaint = pct;
      }
      const color = ratio > 0.55 ? '#7dffa0' : ratio > 0.22 ? '#ffd23f' : '#ff6f91';
      if (bar.dataset.timerColor !== color) {
        bar.style.background = color;
        bar.dataset.timerColor = color;
      }
      const sec = Math.ceil(run.remaining / 1000);
      if (run.remaining < 5000 && sec !== lastSec && sec > 0) tone(220, 0.05);
      lastSec = sec;
      if (run.remaining <= 0) { timerRaf = 0; resolve(null, ''); return; }
    }
    timerRaf = requestAnimationFrame(tick);
  };
  timerRaf = requestAnimationFrame(tick);
}

/* ------------------------------------------------------------- answering */
function submit() {
  if (!run || run.locked || run.paused) return;
  const value = $('answerInput').value.trim();
  if (!value) return;
  const p = run.prompts[run.index];
  const match = matchAnswer(value, p.pool);
  if (match?.near) {
    run.paused = true; run.pending = { match, value };
    $('confirmName').textContent = match.item.n;
    $('confirmBox').classList.add('show');
    $('confirmYes').focus();
    return;
  }
  resolve(match?.item || null, value);
}

function confirmNear(yes) {
  if (!run?.pending) return;
  const { match, value } = run.pending;
  run.pending = null; run.paused = false;
  $('confirmBox').classList.remove('show');
  if (yes) resolve(match.item, value);
  else { $('answerInput').focus(); } // no penalty: the player can retype
}

/** A wrong or repeated answer does not end the question: the timer keeps running and the player may try again. */
function retryAnswer(item, value) {
  const mine = run, input = $('answerInput');
  if (!item) { S.store.misses++; S.save(); }
  mine.tries.push(value);
  const message = item ? `${item.n} was already named in this dive. Try another.` : 'Not recognised. Try another answer.';
  $('feedback').textContent = message;
  $('live').textContent = message;
  tone(110, 0.12);
  if (S.store.settings.haptics) buzz([20, 40, 20]);
  input.classList.remove('wrong'); void input.offsetWidth; input.classList.add('wrong');
  input.value = ''; input.focus();
}

async function resolve(item, value) {
  if (!run || run.locked) return;
  if (value && run.remaining > 0 && (!item || run.used.has(item.id))) { retryAnswer(item, value); return; }
  run.locked = true;
  clearInterval(run.timer);
  const mine = run;
  $('answerInput').disabled = true; $('submitBtn').disabled = true; $('swapBtn').disabled = true;
  $('confirmBox').classList.remove('show');
  const p = run.prompts[run.index];

  let points = 0, state = 'miss', message;
  if (!value) { message = "Time's up. Depth holds."; state = 'timeout'; }   // also reached after wrong tries: the clock ran out
  else if (!item) { message = 'Not recognised for this prompt. Depth holds.'; S.store.misses++; S.save(); }
  else if (run.used.has(item.id)) { message = `${item.n} was already named in this dive.`; state = 'repeat'; }
  else {
    run.used.add(item.id);
    points = item.r;
    if (crowdEnabled()) {
      const key = item.keys[0];
      const stats = await crowdStats(p.key, key);
      points = blendPoints(points, stats, { minSamples: CONFIG.CROWD_MIN_SAMPLES, weight: CONFIG.CROWD_WEIGHT }).points;
      crowdSubmit(p.key, key);
    }
    state = 'hit';
    message = `${item.n} · ${tier(points)} · +${points} pts`;
    tone(220 + points * 5, 0.22, 'triangle');
    if (S.store.settings.haptics) buzz(points > 80 ? [30, 30, 60] : 25);
  }
  if (run !== mine) return;
  if (state !== 'hit') tone(110, 0.16);
  mine.depth += points * CONFIG.POINTS_PER_METER;
  mine.answers.push({
    prompt: p.text, input: value || (mine.tries.length ? mine.tries.join(' / ') : '(no answer)'), name: item?.n || '', points, tier: tier(points), state,
    examples: examples(p.pool),
  });
  $('feedback').textContent = message;
  $('live').textContent = message;
  updateDepthUI(mine.depth);
  // Visual-only rarity encounter. Answer points/state are read; scoring and progression are untouched.
  triggerAnswerVisual(points, state);
  flashTier(points, state);
  mine.index++;
  paintSteps();
  setTimeout(() => { if (run === mine) nextPrompt(); }, 1100);
}

/* ---- Per-prompt progress steps and the tier flash shown after each answer ---- */
function paintSteps() {
  const box = $('steps'); if (!box || !run) return;
  const n = CONFIG.PROMPTS_PER_DIVE;
  while (box.children.length < n) box.appendChild(document.createElement('i'));
  for (let i = 0; i < n; i++) {
    const a = run.answers[i];
    box.children[i].className = a ? (a.points ? 'done ' + tierClass(a.tier) : 'miss') : (i === run.index ? 'now' : '');
  }
}
let tierFlashEl = null;
function flashTier(points, state) {
  if (!tierFlashEl) { tierFlashEl = document.createElement('div'); tierFlashEl.className = 'tier-flash'; tierFlashEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(tierFlashEl); }
  const b = document.createElement('b'), small = document.createElement('small');
  if (points > 0) { b.textContent = tier(points); b.className = tierClass(tier(points)); small.textContent = `+${points} pts · sink ${Math.round(points * CONFIG.POINTS_PER_METER)} m`; }
  else { b.textContent = state === 'repeat' ? 'Repeat' : 'Miss'; b.className = 'miss'; small.textContent = 'no depth this time'; }
  tierFlashEl.replaceChildren(b, small);
  tierFlashEl.classList.remove('show'); void tierFlashEl.offsetWidth; tierFlashEl.classList.add('show');
}

/* ---------------------------------------------------------------- finishing */
function finish() {
  clearInterval(run.timer);
  const valid = run.answers.filter(a => a.points > 0).length;
  const streak = S.recordDive({ mode: run.mode, depth: run.depth, answers: valid });
  renderResults(run, run.mode === 'daily' ? streak : S.liveStreak());
  show('results');
  document.body.classList.remove('in-game');
}

async function share() {
  if (!run) return;
  const marks = run.answers.map(a => (a.points >= 70 ? '◈' : a.points ? '◆' : '·')).join('');
  const head = run.mode === 'daily' ? `DEEPWELL ${utcDate()} · ${Math.round(run.depth)} m` : `DEEPWELL ${Math.round(run.depth)} m`;
  const text = `${head}\n${marks}\nCan you think deeper? https://${CONFIG.DOMAIN}`;
  try {
    if (navigator.share) await navigator.share({ title: CONFIG.TITLE, text });
    else { await navigator.clipboard.writeText(text); toast('Result copied.'); }
  } catch { toast('Share cancelled.'); }
}

/* ------------------------------------------------------------------- events */
function bind() {
  $('dailyBtn').onclick = () => startDive('daily');
  $('endlessBtn').onclick = () => startDive('endless');
  $('packsBtn').onclick = () => show('packs');
  $('howBtn').onclick = () => show('how');
  $('statsBtn').onclick = () => show('stats');
  $('settingsBtn').onclick = () => show('settings');
  $('submitBtn').onclick = submit;
  $('swapBtn').onclick = swapPrompt;
  $('answerInput').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  $('confirmYes').onclick = () => confirmNear(true);
  $('confirmNo').onclick = () => confirmNear(false);
  $('againBtn').onclick = () => (run?.mode === 'pack' ? startDive('pack', run.category) : startDive('endless'));
  $('resultHomeBtn').onclick = () => show('home');
  $('shareBtn').onclick = share;
  document.querySelectorAll('[data-home]').forEach(x => { x.onclick = () => show('home'); });
  ['soundSetting', 'hapticSetting', 'motionSetting', 'colorSetting', 'timerSetting', 'textSetting']
    .forEach(id => $(id).addEventListener('change', readSettingsUI));
  addEventListener('pointerdown', wake, { once: true });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('game').classList.contains('active')) show('home');
  });
}

async function boot() {
  S.load();
  applySettings();
  buildPackButtons(cat => startDive('pack', cat));
  bind();
  startScene(() => run?.depth || 0, () => S.store.settings.motion, () => run ? run.index / CONFIG.PROMPTS_PER_DIVE : 0, () => S.store.settings.haptics, () => S.store.settings.color);
  updateDepthUI(0);
  renderHome();
  await loadManifest();
  renderHome();
  setInterval(() => { if ($('home').classList.contains('active')) renderHome(); }, 60000);
}
boot();
