// Persistent player state (localStorage, with an in-memory fallback).
import { utcDate, previousUtcDate } from './engine.js?v=apogee-20261127';

const KEY = 'deepwell-v2';
let memory = null;

const DEFAULTS = () => ({
  games: 0, total: 0, best: 0, streak: 0, bestStreak: 0,
  dailyLog: {}, // 'YYYY-MM-DD' -> {depth, answers}
  recentPrompts: [], // question IDs and text used across all dive modes
  misses: 0,
  settings: { sound: 0.45, haptics: true, motion: false, color: false, timer: 20, text: 1, graphics: 'auto' },
});

export const store = DEFAULTS();

export function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = memory; }
  if (saved && typeof saved === 'object') {
    const d = DEFAULTS();
    Object.assign(store, d, saved, { settings: { ...d.settings, ...(saved.settings || {}) } });
  }
  store.recentPrompts = Array.isArray(store.recentPrompts) ? store.recentPrompts.slice(-20000) : [];
  return store;
}

export function save() {
  memory = JSON.parse(JSON.stringify(store));
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode: memory only */ }
}

export const dailyDone = (date = utcDate()) => Boolean(store.dailyLog[date]);

/** Record a finished dive. Returns the new streak (daily only changes it). */
export function recordDive({ mode, depth, answers }) {
  store.games++;
  store.total += depth;
  if (depth > store.best) store.best = depth;
  if (mode === 'daily') {
    const today = utcDate();
    store.dailyLog[today] = { depth, answers };
    store.streak = store.dailyLog[previousUtcDate(today)] ? store.streak + 1 : 1;
    if (store.streak > store.bestStreak) store.bestStreak = store.streak;
  }
  save();
  return store.streak;
}

/** Streak as shown today: it lapses if neither today nor yesterday was played. */
export function liveStreak() {
  const today = utcDate();
  return store.dailyLog[today] || store.dailyLog[previousUtcDate(today)] ? store.streak : 0;
}

export function rememberPrompts(ids) {
  store.recentPrompts = [...new Set([...store.recentPrompts, ...ids])].slice(-20000);
  save();
}
