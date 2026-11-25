// Dive preparation: choose prompts, load their answer pools, apply letter variants.
import { CONFIG } from './config.js?v=hud-steps-20261125';
import { CATALOG, loadRawPool, stableEntries, promptMeta } from './data.js?v=hud-steps-20261125';
import {
  pickEntries, planDive, mulberry32, hashString, buildPool, deriveLetterPool, chooseVariant,
  promptKey, promptText, utcDate,
} from './engine.js?v=hud-steps-20261125';

const historyKey = text => `question:${String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;

function rememberInSet(set, prompt) {
  set.add(prompt.entry.id);
  set.add(prompt.key);
  set.add(historyKey(prompt.text));
}

/** Load candidates in small parallel batches, skipping questions used in earlier dives. */
async function loadCandidates(candidates, count, allowLive, seen = new Set()) {
  const prompts = [];
  let next = 0;
  while (prompts.length < count && next < candidates.length) {
    const batch = [];
    while (next < candidates.length && batch.length < count - prompts.length) {
      const pick = candidates[next++];
      if (!seen.has(pick.entry.id)) batch.push(pick);
    }
    if (!batch.length) continue;
    const loaded = await Promise.all(batch.map(pick => ready(pick, allowLive)));
    for (const prompt of loaded) {
      if (!prompt) continue;
      const key = historyKey(prompt.text);
      if (seen.has(prompt.entry.id) || seen.has(prompt.key) || seen.has(key)) continue;
      rememberInSet(seen, prompt);
      prompts.push(prompt);
    }
  }
  return prompts;
}

/** Load one pick into a ready prompt, or null if its data is unusable. */
async function ready(pick, allowLive) {
  const { entry } = pick;
  try {
    const raw = await loadRawPool(entry, { allowLive });
    const opts = { people: Boolean(entry.people) };
    let pool = buildPool(raw.items, opts);
    const minimumItems = Math.min(entry.minPool || 20, 8);
    if (pool.size < minimumItems) return null;
    const letter = entry.startsWith ? null : chooseVariant(pick, pool, { minPool: CONFIG.MIN_POOL_FOR_LETTER, chance: 0.8 });
    if (letter) {
      const sub = deriveLetterPool(pool, letter, opts);
      if (sub.size >= 8) pool = sub;
      else return buildPrompt(entry, null, pool, raw.source, pick.level);
    }
    return buildPrompt(entry, letter, pool, raw.source, pick.level);
  } catch (error) {
    console.warn('[DEEPWELL] Could not load prompt data for ' + entry.id, error);
    return null;
  }
}

function buildPrompt(entry, letter, pool, source, level = 2) {
  return { entry, letter, pool, source, key: promptKey(entry, letter), text: promptText(entry, letter), cat: entry.cat, level };
}

const SPARES = 2; // replacement questions for the one-per-dive Swap

/** A dive is `count` prompts; anything extra that loaded becomes a spare for the Swap button (prompts.spares). */
function asDive(prompts, count) {
  const dive = prompts.slice(0, count);
  dive.spares = prompts.slice(count, count + SPARES);
  return dive;
}

/**
 * Each dive gets a new random set, built with a fair difficulty curve (easy start, one hard question at the end; see
 * planDive in engine.js). Recent question IDs and question text are avoided across Daily, Endless and themed dives.
 * Previously used questions are reused only when there are not enough unused prompts/data to fill a dive.
 */
export async function prepareDive({ mode, category = null, recent = [] }) {
  const count = CONFIG.PROMPTS_PER_DIVE;
  const stable = stableEntries();
  const inCategory = list => category ? list.filter(e => e.cat === category) : list;
  const rnd = mulberry32(hashString(`${mode}-${utcDate()}-${Date.now()}-${Math.random()}`));
  const history = new Set(recent);
  const selectedHistory = new Set();
  const plan = list => planDive(list, rnd, promptMeta(), { count, spares: SPARES, category });
  const loose = list => pickEntries(list, list.length, rnd);   // plain shuffled order for the last-resort passes

  if (mode === 'daily') {
    const entries = stable;
    if (entries.length < count) throw new Error('Not enough offline questions are available yet.');

    // Daily stays offline and once-per-UTC-day, with a fresh personalised selection for each player.
    const fresh = entries.filter(e => !history.has(e.id));
    const prompts = await loadCandidates(plan(fresh), count + SPARES, false, history);
    if (prompts.length < count) {
      for (const prompt of prompts) rememberInSet(selectedHistory, prompt);
      const replay = await loadCandidates(loose(entries), count - prompts.length, false, selectedHistory);
      prompts.push(...replay);
    }
    if (prompts.length < count) throw new Error('Not enough offline questions could be loaded. Please try again.');
    return asDive(prompts, count);
  }

  const allEntries = inCategory(CATALOG);
  if (allEntries.length < count) throw new Error('Not enough questions are available in this category yet.');

  // Prefer unused offline packs. Once these are exhausted, draw unseen prompts
  // from the full catalog and try live Wikidata only for that small selection.
  const localEntries = inCategory(stable);
  const freshLocal = localEntries.filter(e => !history.has(e.id));
  const prompts = await loadCandidates(plan(freshLocal), count + SPARES, false, history);
  for (const prompt of prompts) rememberInSet(selectedHistory, prompt);
  if (prompts.length >= count) return asDive(prompts, count);

  const remaining = allEntries.filter(e => !history.has(e.id) && !selectedHistory.has(e.id));
  const needed = count - prompts.length;
  const fallbackCandidates = pickEntries(remaining, Math.min(remaining.length, needed + 80), rnd);
  const fallback = await loadCandidates(fallbackCandidates, needed, true, new Set([...history, ...selectedHistory]));
  prompts.push(...fallback);
  for (const prompt of fallback) rememberInSet(selectedHistory, prompt);
  if (prompts.length >= count) return asDive(prompts, count);

  // Last resort: reuse a local pack, but still avoid duplicate prompts within this particular dive.
  const replay = await loadCandidates(loose(localEntries), count - prompts.length, false, selectedHistory);
  prompts.push(...replay);
  if (prompts.length < count) throw new Error('Not enough questions could be loaded. Check your connection and try again.');
  return asDive(prompts, count);
}

/** Example answers for the results screen: two famous, one rare. */
export function examples(pool) {
  const it = pool.items, n = it.length;
  const names = [it[0]?.n, it[1]?.n].filter(Boolean);
  const rare = it[Math.floor(n * 0.85)]?.n;
  return { famous: names, rare: rare && !names.includes(rare) ? rare : null };
}
