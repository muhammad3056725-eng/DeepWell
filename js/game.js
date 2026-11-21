// Dive preparation: choose prompts, load their answer pools, apply letter variants.
import { CONFIG } from './config.js?v=ten-thousand-prompts-20261121';
import { CATALOG, loadRawPool, stableEntries } from './data.js?v=ten-thousand-prompts-20261121';
import {
  pickEntries, mulberry32, hashString, buildPool, deriveLetterPool, chooseVariant,
  promptKey, promptText, utcDate,
} from './engine.js?v=ten-thousand-prompts-20261121';

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
  } catch {
    return null;
  }
}

function buildPrompt(entry, letter, pool, source) {
  return { entry, letter, pool, source, key: promptKey(entry, letter), text: promptText(entry, letter), cat: entry.cat };
}

/**
 * mode: 'daily' | 'endless' | 'pack'. Returns exactly PROMPTS_PER_DIVE prompts,
 * or throws when the library cannot supply enough.
 * Daily is deterministic: same UTC date + same data = same seven prompts for everyone.
 */
export async function prepareDive({ mode, category = null, recent = [] }) {
  const count = CONFIG.PROMPTS_PER_DIVE;
  const stable = stableEntries();
  let entries, allowLive, rnd, avoid;

  if (mode === 'daily') {
    entries = stable; allowLive = false;
    rnd = mulberry32(hashString('deepwell-daily-' + utcDate()));
    avoid = new Set();
  } else {
    const inCat = list => (category ? list.filter(e => e.cat === category) : list);
    // Endless and category packs draw from the full 10k library. Missing offline
    // packs are fetched live only for the small number of prompts selected.
    entries = inCat(CATALOG);
    allowLive = true;
    rnd = mulberry32(hashString(`${Date.now()}-${Math.random()}`));
    avoid = new Set(recent);
  }
  if (entries.length < count) throw new Error('Not enough questions available yet.');

  const candidates = pickEntries(entries, count + 80, rnd, { avoid, category: mode === 'pack' ? category : null });
  const results = new Array(candidates.length).fill(undefined);
  let next = 0, have = 0;
  while (have < count && next < candidates.length) {
    const batch = [];
    for (let i = 0; i < count - have && next < candidates.length; i++) batch.push(next++);
    const loaded = await Promise.all(batch.map(i => ready(candidates[i], allowLive)));
    batch.forEach((idx, k) => { results[idx] = loaded[k]; if (loaded[k]) have++; });
  }
  const prompts = results.filter(Boolean).slice(0, count);
  if (prompts.length < count) throw new Error('Not enough questions could be loaded. Check your connection.');
  return prompts;
}

/** Example answers for the results screen: two famous, one rare. */
export function examples(pool) {
  const it = pool.items, n = it.length;
  const names = [it[0]?.n, it[1]?.n].filter(Boolean);
  const rare = it[Math.floor(n * 0.85)]?.n;
  return { famous: names, rare: rare && !names.includes(rare) ? rare : null };
}
