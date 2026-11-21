// DEEPWELL entry point: wires the screens to the game rules.
import { CONFIG } from './config.js?v=answer-expansion-20261121';
import { matchAnswer, tier, blendPoints, utcDate } from './engine.js?v=answer-expansion-20261121';
import { loadManifest } from './data.js?v=answer-expansion-20261121';
import { prepareDive, examples } from './game.js?v=answer-expansion-20261121';
import { crowdEnabled, crowdStats, crowdSubmit } from './crowd.js';
import * as S from './state.js';
import { startScene, triggerAnswerVisual, resetDiveVisual } from './scene.js?v=immersive-descent-20261121';
import { wake, tone, buzz } from './audio.js';
import {
  $, show, toast, updateDepthUI, renderHome, renderResults,
  buildPackButtons, applySettings, readSettingsUI,
} from './ui.js?v=answer-expansion-20261121';

let run = null; // the dive in progress
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
  $('roundLabel').textContent = 'LOADING';
  $('modeLabel').textContent = label(mode, category);
  $('srcBadge').textContent = '';
  $('promptText').innerHTML = '<span class="loading">Finding questions…</span>';
  $('feedback').textContent = '';
  $('timerBar').style.width = '100%';
  $('answerInput').disabled = true; $('submitBtn').disabled = true;
  updateDepthUI(0);

  let prompts;
  try {
    prompts = await prepareDive({ mode, category, recent: S.store.recentPrompts });
  } catch (e) {
    if (id !== runId) return;
    toast(e.message || 'Could not start a dive.');
    show('home');
    return;
  }
  if (id !== runId) return;
  if (mode !== 'daily') S.rememberPrompts(prompts.map(p => p.key));
  run = { mode, category, prompts, index: 0, depth: 0, answers: [], used: new Set(), remaining: 0, locked: false, paused: false, timer: null, pending: null, id };
  $('answerInput').disabled = false; $('submitBtn').disabled = false;
  nextPrompt();
}

const label = (mode, cat) => (mode === 'daily' ? 'DAILY DIVE' : mode === 'pack' ? String(cat).toUpperCase() : 'ENDLESS DIVE');

function nextPrompt() {
  if (run.index >= run.prompts.length) return finish();
  const p = run.prompts[run.index];
  run.locked = false; run.paused = false; run.pending = null;
  $('confirmBox').classList.remove('show');
  $('roundLabel').textContent = `PROMPT ${run.index + 1} / ${run.prompts.length}`;
  const badge = $('srcBadge');
  badge.textContent = SOURCE_LABEL[p.source] || '';
  badge.className = 'src-badge ' + (p.source === 'live' ? 'live' : p.source === 'seed' ? 'seed' : '');
  $('promptText').textContent = p.text;
  $('feedback').textContent = '';
  const input = $('answerInput');
  input.value = ''; input.disabled = false; $('submitBtn').disabled = false; input.focus();
  startTimer();
}

/* ------------------------------------------------------------------- timer */
function startTimer() {
  clearInterval(run.timer);
  const seconds = run.mode === 'daily' ? CONFIG.DAILY_SECONDS : S.store.settings.timer;
  run.total = seconds * 1000; run.remaining = run.total;
  const bar = $('timerBar');
  bar.style.background = 'var(--cyan)';
  let last = performance.now(), lastSec = seconds;
  const mine = run;
  run.timer = setInterval(() => {
    if (run !== mine) return clearInterval(mine.timer);
    const now = performance.now(), dt = now - last; last = now;
    if (run.paused || run.locked) return;
    run.remaining = Math.max(0, run.remaining - dt);
    bar.style.width = (run.remaining / run.total) * 100 + '%';
    const sec = Math.ceil(run.remaining / 1000);
    if (run.remaining < 5000) {
      bar.style.background = 'var(--pink)';
      if (sec !== lastSec && sec > 0) tone(220, 0.05);
    }
    lastSec = sec;
    if (run.remaining <= 0) { clearInterval(run.timer); resolve(null, ''); }
  }, 100);
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

async function resolve(item, value) {
  if (!run || run.locked) return;
  run.locked = true;
  clearInterval(run.timer);
  const mine = run;
  $('answerInput').disabled = true; $('submitBtn').disabled = true;
  $('confirmBox').classList.remove('show');
  const p = run.prompts[run.index];

  let points = 0, state = 'miss', message;
  if (!value) { message = "Time's up. Depth holds."; state = 'timeout'; }
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
    prompt: p.text, input: value || '(no answer)', name: item?.n || '', points, tier: tier(points), state,
    examples: examples(p.pool),
  });
  $('feedback').textContent = message;
  $('live').textContent = message;
  updateDepthUI(mine.depth);
  // Visual-only rarity encounter. Answer points/state are read; scoring and progression are untouched.
  triggerAnswerVisual(points, state);
  mine.index++;
  setTimeout(() => { if (run === mine) nextPrompt(); }, 1100);
}

/* ---------------------------------------------------------------- finishing */
function finish() {
  clearInterval(run.timer);
  const valid = run.answers.filter(a => a.points > 0).length;
  const streak = S.recordDive({ mode: run.mode, depth: run.depth, answers: valid });
  renderResults(run, run.mode === 'daily' ? streak : S.liveStreak());
  show('results');
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
  startScene(() => run?.depth || 0, () => S.store.settings.motion, () => run ? run.index / CONFIG.PROMPTS_PER_DIVE : 0);
  updateDepthUI(0);
  renderHome();
  await loadManifest();
  renderHome();
  setInterval(() => { if ($('home').classList.contains('active')) renderHome(); }, 60000);
}
boot();
