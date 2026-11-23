// Dive preparation: choose prompts, load their answer pools, apply letter variants.
import { CONFIG } from './config.js?v=fixes-20261123-1';
import { CATALOG, loadRawPool, stableEntries } from './data.js?v=fixes-20261123-1';
import {
  pickEntries, mulberry32, hashString, buildPool, deriveLetterPool, chooseVariant,
  promptKey, promptText, utcDate,
} from './engine.js?v=fixes-20261123-1';

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
    const letter = entry.startsWith ? null : chooseVariant(pick, pool, { minPool: CONFIG.MIN_POOL_FOR_LETTER });
    if (letter) {
      const sub = deriveLetterPool(pool, letter, opts);
      if (sub.size >= 8) pool = sub;
      else return buildPrompt(entry, null, pool, raw.source);
    }
    return buildPrompt(entry, letter, pool, raw.source);
  } catch (error) {
    console.warn('[DEEPWELL] Could not load prompt data for ' + entry.id, error);
    return null;
  }
}

function buildPrompt(entry, letter, pool, source) {
  return { entry, letter, pool, source, key: promptKey(entry, letter), text: promptText(entry, letter), cat: entry.cat };
}

/**
 * Each dive gets a new random set. Recent question IDs and question text are
 * avoided across Daily, Endless and themed dives. Previously used questions
 * are reused only when there are not enough unused prompts/data to fill a dive.
 */
export async function prepareDive({ mode, category = null, recent = [] }) {
  const count = CONFIG.PROMPTS_PER_DIVE;
  const stable = stableEntries();
  const inCategory = list => category ? list.filter(e => e.cat === category) : list;
  const rnd = mulberry32(hashString(`${mode}-${utcDate()}-${Date.now()}-${Math.random()}`));
  const history = new Set(recent);
  const selectedHistory = new Set();

  if (mode === 'daily') {
    const entries = stable;
    if (entries.length < count) throw new Error('Not enough offline questions are available yet.');

    // Daily remains offline and once-per-UTC-day, but each player gets a fresh,
    // personalized selection instead of a globally fixed seven-question set.
    const fresh = entries.filter(e => !history.has(e.id));
    const candidates = pickEntries(fresh, fresh.length, rnd);
    const prompts = await loadCandidates(candidates, count, false, history);
    if (prompts.length < count) {
      for (const prompt of prompts) rememberInSet(selectedHistory, prompt);
      const replayCandidates = pickEntries(entries, entries.length, rnd);
      const replay = await loadCandidates(replayCandidates, count - prompts.length, false, selectedHistory);
      prompts.push(...replay);
    }
    if (prompts.length < count) throw new Error('Not enough offline questions could be loaded. Please try again.');
    return prompts.slice(0, count);
  }

  const allEntries = inCategory(CATALOG);
  if (allEntries.length < count) throw new Error('Not enough questions are available in this category yet.');

  // Prefer unused offline packs. Once these are exhausted, draw unseen prompts
  // from the full catalog and try live Wikidata only for that small selection.
  const localEntries = inCategory(stable);
  const freshLocal = localEntries.filter(e => !history.has(e.id));
  const localCandidates = pickEntries(freshLocal, freshLocal.length, rnd);
  const prompts = await loadCandidates(localCandidates, count, false, history);
  for (const prompt of prompts) rememberInSet(selectedHistory, prompt);
  if (prompts.length >= count) return prompts.slice(0, count);

  const remaining = allEntries.filter(e =>
    !history.has(e.id) && !selectedHistory.has(e.id)
  );
  const needed = count - prompts.length;
  const fallbackCandidates = pickEntries(
    remaining,
    Math.min(remaining.length, needed + 80),
    rnd,
  );
  const fallback = await loadCandidates(
    fallbackCandidates,
    needed,
    true,
    new Set([...history, ...selectedHistory]),
  );
  prompts.push(...fallback);
  for (const prompt of fallback) rememberInSet(selectedHistory, prompt);
  if (prompts.length >= count) return prompts.slice(0, count);

  // Last resort: reuse a local pack, but still avoid duplicate prompts within
  // this particular dive. This prevents a depleted offline pool blocking play.
  const replayCandidates = pickEntries(localEntries, localEntries.length, rnd);
  const replay = await loadCandidates(replayCandidates, count - prompts.length, false, selectedHistory);
  prompts.push(...replay);

  if (prompts.length < count) {
    throw new Error('Not enough questions could be loaded. Check your connection and try again.');
  }
  return prompts.slice(0, count);
}

/** Example answers for the results screen: two famous, one rare. */
export function examples(pool) {
  const it = pool.items, n = it.length;
  const names = [it[0]?.n, it[1]?.n].filter(Boolean);
  const rare = it[Math.floor(n * 0.85)]?.n;
  return { famous: names, rare: rare && !names.includes(rare) ? rare : null };
}
