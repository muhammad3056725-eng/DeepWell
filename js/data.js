// Data loading. Source order for a prompt's answer pool:
//   1. linked store     data/linked/ (v4: every answer stored once; see js/linked.js)
//   2. offline seed     js/seed.js   (small hand-curated fallback bundled with the site)
//   3. live Wikidata    queried from the browser (Endless mode only, never for the Daily Flight)
import { CONFIG } from './config.js?v=apogee-20261127';
import { CATALOG, CATALOG_BY_ID, registerCurated } from './catalog.js?v=apogee-20261127';
import { SEED } from './seed.js';
import { fetchLive, fromPack, ANSWER_CAP } from './wikidata.js?v=apogee-20261127';
import { loadLinkedItems } from './linked.js?v=apogee-20261127';
import { normalize } from './engine.js?v=apogee-20261127';

let manifest = { version: 0, built: null, packs: {} };
let meta = null; // data/prompt-meta.json: per-prompt difficulty level, optional
const rawCache = new Map(); // entry id -> Promise<{items, source}>

let readyResolve;
/** Resolves once the manifest (and the curated prompts it lists) is loaded, even if loading failed. */
export const dataReady = new Promise(r => { readyResolve = r; });

export async function loadManifest() {
  try {
    const res = await fetch(CONFIG.MANIFEST_URL, { cache: 'no-cache' });
    if (res.ok && /json/.test(res.headers.get('content-type') || 'json')) {
      const m = await res.json();
      if (m && typeof m.packs === 'object') manifest = m;
    }
  } catch { /* offline or not built yet: seed only */ }
  // Curated survey prompts ("Name something people do at a party") reach the catalog through the manifest.
  registerCurated(Object.entries(manifest.packs).filter(([, p]) => p.kind === 'curated').map(([id, p]) => ({ id, ...p })));
  // Overlays may give a Wikidata prompt friendlier wording ("Name an insect or bug").
  for (const [id, p] of Object.entries(manifest.packs)) if (p.overlay && p.prompt && CATALOG_BY_ID.has(id)) CATALOG_BY_ID.get(id).prompt = p.prompt;
  try {
    const res = await fetch(`data/prompt-meta.json?v=${manifest.version || 0}`);
    if (res.ok) meta = await res.json();
  } catch { /* no metadata: every prompt counts as medium */ }
  readyResolve(manifest);
  return manifest;
}

export const promptMeta = () => meta;
export const hasPack = id => Boolean(manifest.packs[id]);
export const hasSeed = id => typeof SEED[id] === 'string';

/** Entries that can be served without a live query: the only ones the Daily Flight may use. */
export function stableEntries() {
  return CATALOG.filter(e => hasPack(e.id) || hasSeed(e.id));
}

export function libraryStats() {
  let answers = 0, packs = 0;
  for (const id of Object.keys(manifest.packs)) { answers += manifest.packs[id].n || 0; packs++; }
  for (const id of Object.keys(SEED)) {
    if (!hasPack(id)) answers += SEED[id].split('|').length;
  }
  return { prompts: CATALOG.length, packs, answers, unique: manifest.store?.entities || 0, built: manifest.built, stable: stableEntries().length };
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
  const meta = manifest.packs[entry.id];
  let items;
  if (manifest.store?.v === 4) {
    items = await loadLinkedItems(meta, manifest, fetch, entry.id);
  } else {
    const res = await fetch(`${CONFIG.PACK_DIR}/${entry.id}.json?v=${manifest.version || 0}`);
    if (!res.ok) throw new Error('pack ' + res.status);
    items = fromPack(await res.json());
  }
  const answerLimit = Math.max(1, Math.min(Number(entry.target ?? entry.answerLimit) || 2000, ANSWER_CAP));
  items = items.slice(0, Math.max(answerLimit, items.length));
  if (items.length < Math.min(entry.minPool || 20, 8)) throw new Error('pack too small');
  return { items, source: meta?.kind === 'curated' ? 'curated' : 'wikidata' };
}

async function load(entry, allowLive) {
  let result = null;
  if (hasPack(entry.id)) {
    try { result = await fromPackFile(entry); } catch { /* fall through */ }
  }
  if (!result && hasSeed(entry.id)) {
    const items = parseSeed(entry);
    if (items && items.length >= 8) result = { items, source: 'seed' };
  }
  if (!result && allowLive && entry.kind !== 'curated') {
    const items = await fetchLive(entry, { endpoint: CONFIG.WIKIDATA_ENDPOINT, timeoutMs: CONFIG.LIVE_TIMEOUT_MS });
    if (items.length >= Math.min(entry.minPool || 20, 8)) result = { items, source: 'live' };
  }
  if (!result) throw new Error('no data for ' + entry.id);
  return result;
}

/**
 * Load the raw pool for an entry. Throws if no usable source exists.
 * `allowLive` enables the browser-side Wikidata query as a last resort.
 */
export function loadRawPool(entry, { allowLive = false } = {}) {
  if (!rawCache.has(entry.id)) {
    const p = load(entry, allowLive);
    rawCache.set(entry.id, p);
    p.catch(() => rawCache.delete(entry.id));
  }
  return rawCache.get(entry.id);
}

export { CATALOG, CATALOG_BY_ID };
