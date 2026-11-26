// Linked answer store, format v4: every answer is stored ONCE for the whole game.
//
//   data/linked/e.<k>.json   entity chunks. One row per answer (id, name, popularity, aliases), shared by every
//                            question it answers. "Shah Rukh Khan" is one row even though he answers "Name an actor",
//                            "Name a film producer" and "Name a TV presenter"; "pizza" is one row for "food at a party",
//                            "pizza topping" and "fast food". Rows are grouped by the smallest question that uses them,
//                            so a question mostly downloads chunks full of its own answers.
//   data/linked/q/<id>.json  one small index per question: which rows answer it, plus per-question popularity
//                            overrides for hand-curated answers (pizza is the #1 party food, not the #1 fast food).
//
// Entity chunk: { v:4, chunk, ids:[number|string], names:[], s:[], aliases:{rowIndex:[...]} }
//   ids: number n = Wikidata Q<n>; strings ("c:pizza", "manual:...") are kept as they are.
// Question index: { v:4, id, r:{ "<chunk>": [delta-encoded row numbers] }, o:{ "<chunk>.<row>": popularity } }
// Manifest: manifest.store = { v:4, chunks:[{n,hash,bytes}], entities, memberships }
//           manifest.packs[id] = { n, chunks:[k...], qhash, source, kind?, prompt?, cat?, level? }
//
// No DOM or Node-only code here: the browser loader and the Node tooling share this file.

export const LINKED_DIR = 'data/linked';
export const CHUNK_BYTES = 96 * 1024;   // target raw size of one entity chunk (about 30 KB gzipped)
export const MAX_SHARD_PROMPTS = Infinity; // kept for old tooling; v4 has no per-shard question limit

export const idOut = id => /^Q\d+$/.test(id) ? Number(id.slice(1)) : String(id);
export const idIn = v => typeof v === 'number' ? 'Q' + v : String(v);

/** Rows of one entity chunk as [{id,n,s,a}]. */
export function entityRows(chunk) {
  return (chunk.names || []).map((n, i) => ({ id: idIn(chunk.ids[i]), n, s: Number(chunk.s?.[i]) || 0, a: chunk.aliases?.[i] || [] }));
}

/** Decode a question index into [[chunk, row, override|undefined]] in file order. */
export function questionRefs(q) {
  const out = [];
  for (const [c, deltas] of Object.entries(q.r || {})) {
    let row = 0;
    deltas.forEach((d, i) => { row = i ? row + d : d; out.push([Number(c), row, q.o?.[`${c}.${row}`]]); });
  }
  return out;
}

/** Encode refs ([[chunk,row,override?]]) into the compact question-index form. */
export function encodeRefs(id, refs) {
  const by = new Map(), o = {};
  for (const [c, row, s] of refs) {
    (by.get(c) || by.set(c, []).get(c)).push(row);
    if (s !== undefined) o[`${c}.${row}`] = s;
  }
  const r = {};
  for (const c of [...by.keys()].sort((a, b) => a - b)) {
    const rows = [...new Set(by.get(c))].sort((a, b) => a - b);
    r[c] = rows.map((v, i) => (i ? v - rows[i - 1] : v));
  }
  return { v: 4, id, r, ...(Object.keys(o).length ? { o } : {}) };
}

/** Items of a question given its index and a chunk lookup (chunk number -> rows). Sorted best known first. */
export function itemsFromRefs(q, rowsOf) {
  const out = [];
  for (const [c, row, s] of questionRefs(q)) {
    const r = rowsOf(c)?.[row];
    if (r) out.push({ id: r.id, n: r.n, s: s ?? r.s, a: r.a });
  }
  return out.sort((a, b) => b.s - a.s || a.n.localeCompare(b.n));
}

/* ------------------------------------------------------------------ legacy v3 (read-only, for migration) */
export function chunkRows(chunk) {
  return (chunk.names || []).map((n, i) => ({
    id: idIn(chunk.ids[i]), n, s: Number(chunk.sitelinks?.[i]) || 0, a: chunk.aliases?.[i] || [], m: chunk.m ? chunk.m[i] : undefined,
  }));
}
export function itemsForBit(rows, bit) {
  const out = [];
  for (const r of rows) if (r.m === undefined || (r.m >> bit) & 1) out.push({ id: r.id, n: r.n, s: r.s, a: r.a });
  return out.filter(i => i.id && i.n).sort((a, b) => b.s - a.s);
}

/* ------------------------------------------------------------- browser loader */
const chunkCache = new Map(); // "<k>.<version>" -> Promise<rows>

function loadChunk(k, version, fetchFn) {
  const key = `${k}.${version}`;
  if (!chunkCache.has(key)) {
    chunkCache.set(key, fetchFn(`${LINKED_DIR}/e.${k}.json?v=${version}`).then(r => {
      if (!r.ok) throw new Error('chunk ' + r.status);
      return r.json();
    }).then(entityRows).catch(e => { chunkCache.delete(key); throw e; }));
  }
  return chunkCache.get(key);
}

/** Load the answers of one question. Chunks are cached for the session and shared between questions. */
export async function loadLinkedItems(meta, manifest, fetchFn = fetch, id = meta.id) {
  const version = manifest.version || 0;
  const res = await fetchFn(`${LINKED_DIR}/q/${id}.json?v=${version}`);
  if (!res.ok) throw new Error('question index ' + res.status);
  const q = await res.json();
  const chunks = [...new Set(Object.keys(q.r || {}).map(Number))];
  const rows = new Map(await Promise.all(chunks.map(async k => [k, await loadChunk(k, version, fetchFn)])));
  return itemsFromRefs(q, k => rows.get(k));
}
