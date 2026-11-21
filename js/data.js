// Data loading. Source order for a prompt's answer pool:
//   1. pre-built pack   data/packs/<id>.json  (built from Wikidata by scripts/build-data.mjs)
//   2. offline seed     js/seed.js            (small hand-curated fallback bundled with the site)
//   3. live Wikidata    queried from the browser (Endless mode only, never for the Daily Dive)
import { CONFIG } from './config.js?v=ten-thousand-prompts-20261121';
import { CATALOG, CATALOG_BY_ID } from './catalog.js?v=ten-thousand-prompts-20261121';
import { SEED } from './seed.js';
import { fetchLive, fromPack } from './wikidata.js?v=ten-thousand-prompts-20261121';
import { normalize } from './engine.js?v=ten-thousand-prompts-20261121';

let manifest = { version: 0, built: null, packs: {} };
const rawCache = new Map(); // entry id -> {items, source}

export async function loadManifest() {
  try {
    const res = await fetch(CONFIG.MANIFEST_URL, { cache: 'no-cache' });
    if (res.ok) {
      const m = await res.json();
      if (m && typeof m.packs === 'object') manifest = m;
    }
  } catch { /* offline or not built yet: seed only */ }
  return manifest;
}

export const hasPack = id => Boolean(manifest.packs[id]);
export const hasSeed = id => typeof SEED[id] === 'string';

/** Entries that can be served without a live query: the only ones the Daily Dive may use. */
export function stableEntries() {
  return CATALOG.filter(e => hasPack(e.id) || hasSeed(e.id));
}

export function libraryStats() {
  let answers = 0, packs = 0;
  for (const id of Object.keys(manifest.packs)) { answers += manifest.packs[id].n || 0; packs++; }
  for (const id of Object.keys(SEED)) {
    if (!hasPack(id)) answers += SEED[id].split('|').length;
  }
  return { prompts: CATALOG.length, packs, answers, built: manifest.built, stable: stableEntries().length };
}

export function parseSeed(entry) {
  const text = SEED[entry.id];
  if (!text) return null;
  const parts = text.split('|').map(s => s.trim()).filter(Boolean);
  const seenKey = new Set();
  const items = [];
  parts.forEach((part, i) => {
    const [name, ...aliases] = part.split('=').map(s => s.trim());
    const key = normalize(name);
    if (!key || seenKey.has(key)) return;
    seenKey.add(key);
    // Seed lists are ordered famous -> obscure, so rank stands in for sitelinks.
    items.push({ id: `seed:${entry.id}:${key}`, n: name, a: aliases, s: parts.length - i });
  });
  return items;
}

async function fromPackFile(entry) {
  const res = await fetch(`${CONFIG.PACK_DIR}/${entry.id}.json?v=${manifest.version || 0}`);
  if (!res.ok) throw new Error('pack ' + res.status);
  let items = fromPack(await res.json());
  if (entry.startsWith) items = items.filter(i => i.n.toLowerCase().startsWith(entry.startsWith.toLowerCase()));
  const answerLimit = Math.max(1, Math.min(Number(entry.answerLimit) || 1000, 1000));
  items = items.slice(0, answerLimit);
  if (items.length < Math.min(entry.minPool || 20, 8)) throw new Error('pack too small');
  return { items, source: 'wikidata' };
}

/**
 * Load the raw pool for an entry. Throws if no usable source exists.
 * `allowLive` enables the browser-side Wikidata query as a last resort.
 */
export async function loadRawPool(entry, { allowLive = false } = {}) {
  if (rawCache.has(entry.id)) return rawCache.get(entry.id);
  let result = null;
  if (hasPack(entry.id)) {
    try { result = await fromPackFile(entry); } catch { /* fall through */ }
  }
  if (!result && hasSeed(entry.id)) {
    const items = parseSeed(entry);
    if (items && items.length >= 8) result = { items, source: 'seed' };
  }
  if (!result && allowLive) {
    const items = await fetchLive(entry, { endpoint: CONFIG.WIKIDATA_ENDPOINT, timeoutMs: CONFIG.LIVE_TIMEOUT_MS });
    if (items.length >= Math.min(entry.minPool || 20, 8)) result = { items, source: 'live' };
  }
  if (!result) throw new Error('no data for ' + entry.id);
  rawCache.set(entry.id, result);
  return result;
}

export { CATALOG, CATALOG_BY_ID };
