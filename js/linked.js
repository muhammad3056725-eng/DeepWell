// Linked answer store (pack format v3).
//
// Idea: one answer is stored ONCE, and every question it belongs to just points at it.
//   "Shah Rukh Khan" is an actor, a singer, a film producer ... from India. In the old layout he was copied into each
//   of those question files (with all his aliases). In the linked layout there is one row for him, plus a bit mask that
//   says which questions of the shard he answers.
//
// A SHARD is a group of related questions (all the India questions: actors, poets, cities, rivers, ...).
// A shard is saved as a few CHUNK files (about 300 KB each, most famous answers first) so that very large answer
// lists (up to ANSWER_CAP per question) never make one huge download. A question only fetches the chunks that
// actually contain its answers.
//
// Chunk file:  { v:3, shard, chunk, ids:[number|string], names:[], sitelinks:[], aliases:{rowIndex:[...]}, m:[mask] }
//   ids       number n means Wikidata Q<n>; strings (manual:...) are kept as they are
//   m         one integer per row, bit i set = answers the shard's i-th question; omitted when the shard has 1 question
//
// Manifest:    manifest.shards[shard] = { prompts:[ids], chunks:[{n,hash,bytes}], built }
//              manifest.packs[id]     = { n, shard, bit, chunks:[indexes], ... }   (no hash/bytes: the chunks carry them)
//
// This file has no DOM or Node-only code: the browser loader and the Node tooling share it.

export const MAX_SHARD_PROMPTS = 30;          // one 31-bit integer mask per row
export const CHUNK_BYTES = 300 * 1024;        // target raw size of one chunk file
export const LINKED_DIR = 'data/linked';

const idOut = id => /^Q\d+$/.test(id) ? Number(id.slice(1)) : String(id);
const idIn = v => typeof v === 'number' ? 'Q' + v : String(v);

/**
 * Which shard a question belongs to. Country questions ("actor-from-india", "city-in-india") share a shard per country,
 * everything else is a shard of its own (it still gets chunking, a compact encoding and shared id/alias storage).
 * `countrySuffixes` is the set of country slugs that have at least two questions (computed by the caller).
 */
export function shardOf(id, countrySuffixes = new Set()) {
  const m = /-(?:from|in)-([a-z0-9-]+)$/.exec(id);
  if (m && !/-starts-/.test(id) && countrySuffixes.has(m[1])) return 'c-' + m[1];
  return 'p-' + id;
}

/** Country slugs shared by two or more question ids. */
export function countrySuffixesOf(ids) {
  const count = new Map();
  for (const id of ids) {
    const m = /-(?:from|in)-([a-z0-9-]+)$/.exec(id);
    if (m && !/-starts-/.test(id)) count.set(m[1], (count.get(m[1]) || 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n >= 2).map(([s]) => s));
}

/** Group question ids into shards of at most MAX_SHARD_PROMPTS, deterministically. Returns Map shardId -> [ids]. */
export function planShards(ids) {
  const suffixes = countrySuffixesOf(ids), groups = new Map();
  for (const id of [...ids].sort()) {
    const key = shardOf(id, suffixes);
    (groups.get(key) || groups.set(key, []).get(key)).push(id);
  }
  const out = new Map();
  for (const [key, list] of groups) {
    for (let i = 0; i < list.length; i += MAX_SHARD_PROMPTS) {
      out.set(i ? `${key}-${i / MAX_SHARD_PROMPTS + 1}` : key, list.slice(i, i + MAX_SHARD_PROMPTS));
    }
  }
  return out;
}

// Total order on ids so packing is repeatable: Q-numbers by value, then everything else alphabetically.
const idCompare = (a, b) => {
  const qa = /^Q\d+$/.test(a), qb = /^Q\d+$/.test(b);
  if (qa && qb) return Number(a.slice(1)) - Number(b.slice(1));
  return qa ? -1 : qb ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

const rowBytes = (r) => 12 + r.n.length + (r.a.length ? r.a.join(',').length + r.a.length * 3 : 0);

/**
 * Pack one shard. `pools` is Map promptId -> [{id,n,s,a}]. Returns { prompts, chunks:[object], perPrompt:{id:{n,chunks}} }.
 * Rows are ordered most-famous first; a row's mask lists every question it answers.
 */
export function packShard(shardId, pools) {
  const prompts = [...pools.keys()].sort();
  if (prompts.length > MAX_SHARD_PROMPTS) throw new Error(`shard ${shardId} has ${prompts.length} questions (max ${MAX_SHARD_PROMPTS})`);
  const rows = new Map(); let order = 0;
  prompts.forEach((pid, bit) => {
    for (const it of pools.get(pid)) {
      const key = String(it.id);
      let r = rows.get(key);
      if (!r) { r = { id: key, n: it.n, s: Number(it.s) || 0, a: [], mask: 0, order: order++ }; rows.set(key, r); }
      if ((Number(it.s) || 0) > r.s) { r.s = Number(it.s) || 0; r.n = it.n; }
      r.mask |= (1 << bit);
      for (const a of it.a || []) if (!r.a.includes(a) && a !== r.n) r.a.push(a);
    }
  });
  const sorted = [...rows.values()].sort((x, y) => y.s - x.s || idCompare(x.id, y.id));
  const solo = prompts.length === 1, chunks = [], perPrompt = Object.fromEntries(prompts.map(p => [p, { n: 0, chunks: new Set() }]));
  let cur = null, bytes = 0;
  const open = () => { cur = { v: 3, shard: shardId, chunk: chunks.length, ids: [], names: [], sitelinks: [], aliases: {}, ...(solo ? {} : { m: [] }) }; bytes = 0; chunks.push(cur); };
  for (const r of sorted) {
    if (!cur || (bytes >= CHUNK_BYTES && cur.ids.length)) open();
    const i = cur.ids.length;
    cur.ids.push(idOut(r.id)); cur.names.push(r.n); cur.sitelinks.push(r.s);
    if (r.a.length) cur.aliases[i] = r.a;
    if (!solo) cur.m.push(r.mask);
    bytes += rowBytes(r);
    prompts.forEach((pid, bit) => { if (r.mask & (1 << bit)) { perPrompt[pid].n++; perPrompt[pid].chunks.add(cur.chunk); } });
  }
  for (const pid of prompts) perPrompt[pid].chunks = [...perPrompt[pid].chunks].sort((a, b) => a - b);
  return { prompts, chunks, perPrompt };
}

/** Rows of one chunk file as [{id,n,s,a,m}] (m undefined for single-question shards). */
export function chunkRows(chunk) {
  return (chunk.names || []).map((n, i) => ({
    id: idIn(chunk.ids[i]), n, s: Number(chunk.sitelinks?.[i]) || 0, a: chunk.aliases?.[i] || [], m: chunk.m ? chunk.m[i] : undefined,
  }));
}

/** The answers of question number `bit`, from rows already loaded (any subset of chunks, in rank order). */
export function itemsForBit(rows, bit) {
  const out = [];
  for (const r of rows) if (r.m === undefined || (r.m >> bit) & 1) out.push({ id: r.id, n: r.n, s: r.s, a: r.a });
  return out.filter(i => i.id && i.n).sort((a, b) => b.s - a.s);
}

/* ------------------------------------------------------------- browser loader */

const chunkCache = new Map(); // "<shard>.<n>.<version>" -> Promise<rows>

/**
 * Load the answers of one question from the linked store. Chunks are cached per session, so the second question of a
 * shard (another India question, say) costs no download for the chunks they have in common.
 */
export async function loadLinkedItems(meta, manifest, fetchFn = fetch) {
  const shard = manifest.shards?.[meta.shard];
  if (!shard) throw new Error('unknown shard ' + meta.shard);
  const version = manifest.version || 0, all = [];
  const parts = await Promise.all((meta.chunks || shard.chunks.map((_, i) => i)).map(i => {
    const key = `${meta.shard}.${i}.${version}`;
    if (!chunkCache.has(key)) {
      chunkCache.set(key, fetchFn(`${LINKED_DIR}/${meta.shard}.${i}.json?v=${version}`).then(r => {
        if (!r.ok) throw new Error('chunk ' + r.status);
        return r.json();
      }).then(chunkRows).catch(e => { chunkCache.delete(key); throw e; }));
    }
    return chunkCache.get(key);
  }));
  for (const rows of parts) all.push(...rows);
  return itemsForBit(all, meta.bit || 0);
}
