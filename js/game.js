// Dive preparation: choose prompts, load their answer pools, apply letter variants.
import { CONFIG } from './config.js?v=ten-thousand-prompts-20261121';
import { CATALOG, loadRawPool, stableEntries } from './data.js?v=ten-thousand-prompts-20261121';
import {
  pickEntries, mulberry32, hashString, buildPool, deriveLetterPool, chooseVariant,
  promptKey, promptText, utcDate,
} from './engine.js?v=ten-thousand-prompts-20261121';

/** Load candidates in small parallel batches and keep only usable prompts. */
async function loadCandidates(candidates, count, allowLive, seen = new Set()) {
  const prompts = [];
  let next = 0;
  while (prompts.length < count && next < candidates.length) {
    const size = Math.min(count - prompts.length, candidates.length - next);
    const batch = candidates.slice(next, next + size);
    next += batch.length;
    const loaded = await Promise.all(batch.map(pick => ready(pick, allowLive)));
    for (const prompt of loaded) {
      if (!prompt || seen.has(prompt.entry.id)) continue;
      seen.add(prompt.entry.id);
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
    // Keep the game playable, but preserve a useful diagnostic in DevTools.
    console.warn('[DEEPWELL] Could not load prompt data for ' + entry.id, error);
    return null;
  }
}

function buildPrompt(entry, letter, pool, source) {
  return { entry, letter, pool, source, key: promptKey(entry, letter), text: promptText(entry, letter), cat: entry.cat };
}

/**
 * mode: 'daily' | 'endless' | 'pack'. Returns exactly PROMPTS_PER_DIVE prompts,
 * or throws when the available answer pools cannot supply enough.
 *
 * Until the 10,000-prompt data build is complete, Endless prefers downloaded
 * packs. It only asks Wikidata for prompts when the local packs cannot fill a dive.
 */
export async function prepareDive({ mode, category = null, recent = [] }) {
  const count = CONFIG.PROMPTS_PER_DIVE;
  const stable = stableEntries();
  const inCategory = list => category ? list.filter(e => e.cat === category) : list;
  let rnd, avoid;

  if (mode === 'daily') {
    const entries = stable;
    if (entries.length < count) throw new Error('Not enough offline questions are available yet.');
    rnd = mulberry32(hashString('deepwell-daily-' + utcDate()));
    avoid = new Set();
    const candidates = pickEntries(entries, count + 80, rnd, { avoid });
    const prompts = await loadCandidates(candidates, count, false);
    if (prompts.length < count) throw new Error('Not enough offline questions could be loaded. Please try again.');
    return prompts.slice(0, count);
  }

  rnd = mulberry32(hashString(`${Date.now()}-${Math.random()}`));
  avoid = new Set(recent);
  const allEntries = inCategory(CATALOG);
  if (allEntries.length < count) throw new Error('Not enough questions are available in this category yet.');

  // Prefer the offline packs already on the site. Randomly choosing from all
  // 10,000 prompts while only a small fraction have packs causes most dives to
  // wait on multiple slow browser-side Wikidata queries.
  const localEntries = inCategory(stable);
  const localCandidates = pickEntries(
    localEntries,
    Math.min(localEntries.length, count + 24),
    rnd,
    { avoid },
  );
  const prompts = await loadCandidates(localCandidates, count, false);
  if (prompts.length >= count) return prompts.slice(0, count);

  // Some themed categories may not have seven downloaded packs yet. In that
  // case, supplement the local prompts with a small, bounded live-query fallback.
  const loadedIds = new Set(prompts.map(p => p.entry.id));
  const remaining = allEntries.filter(e => !loadedIds.has(e.id));
  const needed = count - prompts.length;
  const fallbackCandidates = pickEntries(
    remaining,
    Math.min(remaining.length, needed + 7),
    rnd,
    { avoid: new Set([...avoid, ...loadedIds]) },
  );
  const fallback = await loadCandidates(fallbackCandidates, needed, true, loadedIds);
  prompts.push(...fallback);

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
