#!/usr/bin/env node
// Converts between the on-disk layouts of the answer data:
//   loose   data/packs/<question>.json   one file per Wikidata question (what build/patch/enrich scripts work on)
//   linked  data/linked/                 v4 store: every answer stored ONCE, questions point at it (what the site serves)
//   curated data/curated/*.txt           hand-written survey prompts and common-name overlays (see the file headers)
//
//   node scripts/linked-store.mjs unpack            linked -> loose (Wikidata questions only)
//   node scripts/linked-store.mjs pack [--prune] [--from dirA,dirB]
//        loose (+ extra loose dirs, merged by answer id) + curated -> linked; loose files are removed afterwards.
//        --prune drops Wikidata questions that are no longer in js/catalog.js.
//   node scripts/linked-store.mjs stats
//
// Reads the older v3 layout (shards with bit masks) too, so the first pack migrates it.
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fromPack, toPack, ANSWER_CAP } from '../js/wikidata.js';
import { CATALOG } from '../js/catalog.js';
import { normalize, singular } from '../js/engine.js';
import { ensureAnchors } from './data-quality.mjs';
import { LINKED_DIR, CHUNK_BYTES, idOut, entityRows, encodeRefs, itemsFromRefs, chunkRows, itemsForBit } from '../js/linked.js';

const MANIFEST = 'data/manifest.json', LOOSE = 'data/packs', CURATED = 'data/curated';
const sha = v => createHash('sha256').update(v).digest('hex');
const readJson = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
const today = () => new Date().toISOString().slice(0, 10);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };

/* ------------------------------------------------------------------ reading */
const chunkMemo = new Map();
async function readChunk(path) {
  if (!chunkMemo.has(path)) chunkMemo.set(path, JSON.parse(await readFile(path, 'utf8')));
  return chunkMemo.get(path);
}

/** Answers of one question from the linked store, v4 or legacy v3: [{id,n,s,a}] or null. */
export async function readLinkedPrompt(manifest, id, dir = '.') {
  const meta = manifest.packs[id];
  if (!meta) return null;
  if (manifest.store?.v === 4) {
    const q = await readJson(`${dir}/${LINKED_DIR}/q/${id}.json`, null);
    if (!q) return null;
    const rows = new Map();
    for (const c of Object.keys(q.r || {})) rows.set(Number(c), entityRows(await readChunk(`${dir}/${LINKED_DIR}/e.${c}.json`)));
    return itemsFromRefs(q, c => rows.get(c));
  }
  if (!meta.shard) return null;
  const rows = [];
  for (const i of meta.chunks || []) rows.push(...chunkRows(await readChunk(`${dir}/${LINKED_DIR}/${meta.shard}.${i}.json`)));
  return itemsForBit(rows, meta.bit || 0);
}

/** A question's answers from whichever layout holds them: [{id,n,s,a}] or null. */
export async function readAnyPrompt(manifest, id) {
  const loose = await readJson(`${LOOSE}/${id}.json`, null);
  if (loose) return fromPack(loose);
  return readLinkedPrompt(manifest, id);
}

/* ------------------------------------------------------------------ curated */
const display = s => s.charAt(0).toUpperCase() + s.slice(1);
const cKey = s => singular(normalize(s));

/** Parse data/curated/*.txt into [{id, cat, level, prompt, overlay, answers:[{n, a:[]}]}]. */
export async function readCurated(dir = CURATED) {
  const out = [];
  for (const f of (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.txt')).sort()) {
    let cur = null;
    for (const raw of (await readFile(`${dir}/${f}`, 'utf8')).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('@')) {
        const [id, cat, level, ...rest] = line.slice(1).split('|').map(s => s.trim());
        cur = { id, cat: cat === 'overlay' ? null : cat, overlay: cat === 'overlay', level: Number(level) || 2, prompt: rest.join('|'), answers: [], file: f };
        out.push(cur); continue;
      }
      if (!cur) throw new Error(`${f}: answers before the first @prompt line`);
      for (const part of line.split('|')) {
        const names = part.split('=').map(s => s.trim()).filter(Boolean);
        if (names.length) cur.answers.push({ n: names[0], a: names.slice(1) });
      }
    }
  }
  for (const p of out) {      // drop repeats inside one prompt (first mention keeps its rank)
    const seen = new Set();
    p.answers = p.answers.filter(x => { const k = cKey(x.n); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  }
  return out;
}

/** Popularity given to the i-th of n curated answers: the first ties the best-known answer, the last is rare. */
const curatedS = (i, n, top) => Math.max(1, Math.round(top * Math.pow(1 - i / Math.max(1, n), 1.6)));

/* ------------------------------------------------------------------ pack */
async function loadExistingPools(manifest) {
  const pools = new Map();
  for (const [id, meta] of Object.entries(manifest.packs || {})) {
    if (meta.kind === 'curated') continue;
    const items = await readLinkedPrompt(manifest, id);
    if (items?.length) pools.set(id, items);
  }
  return pools;
}

async function readLooseDir(dir) {
  const out = new Map();
  for (const f of (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.json'))) {
    const raw = await readJson(`${dir}/${f}`, null);
    if (raw) out.set(f.slice(0, -5), { items: fromPack(raw), built: raw.built });
  }
  return out;
}

/** Union of two answer lists by id (aliases merged, popularity = max), best known first, capped. */
function unionPools(a = [], b = [], cap = ANSWER_CAP) {
  const by = new Map();
  for (const x of [...a, ...b]) {
    const old = by.get(x.id);
    if (!old) by.set(x.id, { id: x.id, n: x.n, s: Number(x.s) || 0, a: [...(x.a || [])] });
    else { old.s = Math.max(old.s, Number(x.s) || 0); for (const al of x.a || []) if (!old.a.includes(al)) old.a.push(al); }
  }
  const names = new Set();
  return [...by.values()].sort((x, y) => y.s - x.s || x.n.localeCompare(y.n))
    .filter(x => { const k = normalize(x.n); if (names.has(k)) return false; names.add(k); return true; }).slice(0, cap);
}

async function pack() {
  const manifest = await readJson(MANIFEST, { version: 0, built: null, packs: {} });
  const catalog = new Map(CATALOG.map(e => [e.id, e]));
  const pools = await loadExistingPools(manifest);                 // what the site serves now
  const builtOf = new Map();
  const extra = (arg('from', '') || '').split(',').filter(Boolean);
  for (const dir of [LOOSE, ...extra]) {
    for (const [id, { items, built }] of await readLooseDir(dir)) {
      const cap = Math.min(Number(catalog.get(id)?.target) || 2000, ANSWER_CAP);
      pools.set(id, unionPools(pools.get(id), items, cap));
      builtOf.set(id, built || today());
    }
  }
  // Blocklisted answers (data/blocklist.json) never reach the site, whichever layout they came from.
  const block = await readJson('data/blocklist.json', { qids: [], words: [] });
  const blocked = x => (block.qids || []).includes(x.id) || (block.words || []).some(w => String(x.n).toLowerCase().includes(String(w).toLowerCase()));
  for (const [id, items] of pools) pools.set(id, items.filter(x => !blocked(x)));
  // Anchors (data/anchors.json): famous answers every player expects are guaranteed an exact match.
  const anchors = await readJson('data/anchors.json', {});
  const pinned = new Set();      // spellings that must survive the alias cap
  for (const [id, items] of pools) {
    const rule = anchors[id];
    if (rule?.anchors?.length) {
      for (const x of rule.anchors) pinned.add(x);
      pools.set(id, ensureAnchors(items, { ...rule, people: Boolean(catalog.get(id)?.people) }, id).items);
    }
  }
  // A question may exclude the answers of another ("Name a dinosaur" must not accept birds).
  for (const [id, items] of pools) {
    const ex = catalog.get(id)?.exclude;
    if (ex?.length) {
      const other = ex.flatMap(o => pools.get(o) || []);
      const ids = new Set(other.map(x => x.id)), names = new Set(other.flatMap(x => [x.n, ...(x.a || [])]).map(cKey));
      pools.set(id, items.filter(x => !ids.has(x.id) && !names.has(cKey(x.n))));
    }
  }
  if (process.argv.includes('--prune')) {
    let dropped = 0;
    for (const id of [...pools.keys()]) if (!catalog.has(id)) { pools.delete(id); dropped++; }
    console.log(`Pruned ${dropped} Wikidata questions that are no longer in the catalog.`);
  }

  // ---- entities: one record per answer for the whole game
  const ents = new Map();                       // id -> {id, n, s, a:Set}
  const members = new Map();                    // promptId -> Map(entityId -> override popularity | undefined)
  const addEnt = (x) => {
    let e = ents.get(x.id);
    if (!e) { e = { id: x.id, n: x.n, s: Number(x.s) || 0, a: new Set() }; ents.set(x.id, e); }
    if ((Number(x.s) || 0) > e.s) { e.s = Number(x.s); }
    for (const al of x.a || []) if (al && al !== e.n) e.a.add(al);
    return e;
  };
  for (const [id, items] of pools) {
    const m = new Map();
    for (const x of items) { addEnt(x); m.set(x.id, undefined); }
    members.set(id, m);
  }

  // ---- curated prompts and overlays
  const curated = await readCurated();
  for (const p of curated) {
    if (!p.overlay && catalog.has(p.id)) throw new Error(`curated prompt "${p.id}" has the id of a Wikidata question; rename it or mark it "overlay"`);
    if (p.overlay && !catalog.has(p.id)) throw new Error(`overlay "${p.id}" names no Wikidata question in js/catalog.js`);
  }
  const curatedMeta = {};
  for (const p of curated) {
    const m = p.overlay ? (members.get(p.id) || new Map()) : new Map();
    // keys of the answers already in an overlaid Wikidata pool, so "lion" lands on African Lion instead of a copy
    const index = new Map();
    if (p.overlay) for (const eid of m.keys()) { const e = ents.get(eid); for (const k of [e.n, ...e.a]) { const kk = cKey(k); if (kk && !index.has(kk)) index.set(kk, e); } }
    const top = p.overlay ? Math.max(30, ...[...m.keys()].map(id => ents.get(id).s)) : 100;
    p.answers.forEach((ans, i) => {
      const s = curatedS(i, p.answers.length, top);
      let e = null;
      if (p.overlay) for (const k of [ans.n, ...ans.a]) { e = index.get(cKey(k)); if (e) break; }
      if (e) { for (const k of [ans.n, ...ans.a]) if (cKey(k) !== cKey(e.n)) { e.a.add(k); pinned.add(k); } }
      else e = addEnt({ id: 'c:' + cKey(ans.n).replace(/ /g, '-'), n: display(ans.n), s: 0, a: ans.a });
      m.set(e.id, Math.max(s, m.has(e.id) && m.get(e.id) !== undefined ? m.get(e.id) : 0, p.overlay ? e.s : 0));
    });
    members.set(p.id, m);
    curatedMeta[p.id] = p.overlay ? { overlay: true, prompt: p.prompt, level: p.level } : { kind: 'curated', prompt: p.prompt, cat: p.cat, level: p.level };
  }
  // curated-only entities keep popularity 0 globally; their real scores are the per-question overrides

  // ---- layout: each answer lives with the smallest question that uses it
  const qsize = id => members.get(id).size;
  const home = new Map();
  const order = [...members.keys()].sort((a, b) => qsize(a) - qsize(b) || a.localeCompare(b));
  for (const q of order) for (const eid of members.get(q).keys()) if (!home.has(eid)) home.set(eid, q);
  const rank = new Map(order.map((q, i) => [q, i]));
  const laid = [...ents.values()].filter(e => home.has(e.id))
    .sort((x, y) => rank.get(home.get(x.id)) - rank.get(home.get(y.id)) || y.s - x.s || String(x.id).localeCompare(String(y.id)));
  const chunks = [], where = new Map();
  let cur = null, bytes = 0;
  for (const e of laid) {
    if (!cur || bytes >= CHUNK_BYTES) { cur = { v: 4, chunk: chunks.length, ids: [], names: [], s: [], aliases: {} }; chunks.push(cur); bytes = 0; }
    // Keep the most useful spellings: anchors and curated names first, then plain-Latin ones, shortest first.
    const useful = x => (pinned.has(x) ? 0 : 2) + (/^[\x20-\x7e]+$/.test(x) ? 0 : 1);
    const i = cur.ids.length, al = [...e.a].filter(x => x !== e.n).sort((x, y) => useful(x) - useful(y) || x.length - y.length).slice(0, 32);
    cur.ids.push(idOut(e.id)); cur.names.push(e.n); cur.s.push(e.s);
    if (al.length) cur.aliases[i] = al;
    where.set(e.id, [cur.chunk, i]);
    bytes += 14 + e.n.length + al.join(',').length + al.length * 3;
  }

  // ---- write
  await mkdir(`${LINKED_DIR}/q`, { recursive: true });
  const keep = new Set(), store = { v: 4, chunks: [], entities: laid.length, memberships: 0 };
  for (const c of chunks) {
    const raw = JSON.stringify(c), name = `e.${c.chunk}.json`;
    await writeFile(`${LINKED_DIR}/${name}`, raw); keep.add(name);
    store.chunks.push({ n: c.ids.length, hash: sha(raw).slice(0, 16), bytes: Buffer.byteLength(raw) });
  }
  const packs = {}, keepQ = new Set();
  for (const [id, m] of members) {
    if (!m.size) continue;
    const refs = [...m].map(([eid, s]) => [...where.get(eid), s]);
    const q = encodeRefs(id, refs), raw = JSON.stringify(q);
    await writeFile(`${LINKED_DIR}/q/${id}.json`, raw); keepQ.add(`${id}.json`);
    store.memberships += m.size;
    const old = manifest.packs[id] || {}, cm = curatedMeta[id] || {};
    packs[id] = {
      n: m.size, built: builtOf.get(id) || old.built || today(), source: cm.kind === 'curated' ? 'curated' : 'wikidata',
      ...(old.quality ? { quality: old.quality } : {}), ...cm,
      chunks: Object.keys(q.r).map(Number), qhash: sha(raw).slice(0, 16),
    };
  }
  for (const f of await readdir(LINKED_DIR).catch(() => [])) if (f.endsWith('.json') && !keep.has(f)) await rm(`${LINKED_DIR}/${f}`);
  for (const f of await readdir(`${LINKED_DIR}/q`).catch(() => [])) if (!keepQ.has(f)) await rm(`${LINKED_DIR}/q/${f}`);
  for (const f of await readdir(LOOSE).catch(() => [])) if (f.endsWith('.json')) await rm(`${LOOSE}/${f}`);
  const changed = JSON.stringify(Object.values(packs).map(p => p.qhash)) !== JSON.stringify(Object.values(manifest.packs || {}).map(p => p.qhash));
  const next = { version: (manifest.version || 0) + (changed ? 1 : 0), built: changed ? today() : manifest.built, packs, store };
  await writeFile(MANIFEST, JSON.stringify(next));
  console.log(`Packed ${Object.keys(packs).length} questions (${curated.filter(p => !p.overlay).length} curated, ${curated.filter(p => p.overlay).length} overlays) into ${chunks.length} entity chunks: ${laid.length.toLocaleString()} answers stored once, ${store.memberships.toLocaleString()} question memberships.`);
}

async function unpack() {
  const manifest = await readJson(MANIFEST, { packs: {} });
  await mkdir(LOOSE, { recursive: true });
  let n = 0;
  for (const [id, meta] of Object.entries(manifest.packs)) {
    if (meta.kind === 'curated') continue;
    const items = (await readLinkedPrompt(manifest, id)) || [];
    // overlay answers (c:...) are re-applied from data/curated on the next pack, so they are not unpacked
    const pack = toPack({ id, target: ANSWER_CAP }, items.filter(x => !String(x.id).startsWith('c:')));
    pack.built = meta.built || manifest.built || today();
    await writeFile(`${LOOSE}/${id}.json`, JSON.stringify(pack));
    n++;
  }
  console.log(`Unpacked ${n} Wikidata questions into ${LOOSE}/ (curated questions stay in ${CURATED}/).`);
}

async function stats() {
  const manifest = await readJson(MANIFEST, { packs: {} });
  let raw = 0, gz = 0, files = 0;
  for (const dir of [LINKED_DIR, `${LINKED_DIR}/q`]) for (const f of await readdir(dir).catch(() => [])) {
    if (!f.endsWith('.json')) continue;
    const t = await readFile(`${dir}/${f}`, 'utf8'); raw += t.length; gz += gzipSync(t).length; files++;
  }
  const st = manifest.store || {};
  console.log({ questions: Object.keys(manifest.packs).length, entityChunks: st.chunks?.length, files, answersStoredOnce: st.entities,
    memberships: st.memberships, avgQuestionsPerAnswer: (st.memberships / Math.max(1, st.entities)).toFixed(2),
    rawMB: (raw / 1e6).toFixed(2), gzMB: (gz / 1e6).toFixed(2) });
}

const cmd = process.argv[2];
const entry = String(process.argv[1] || '').replace(/\\/g, '/');
if (entry && (import.meta.url === `file://${entry}` || import.meta.url === `file:///${entry}`)) {
  if (cmd === 'pack') await pack();
  else if (cmd === 'unpack') await unpack();
  else if (cmd === 'stats') await stats();
  else { console.error('usage: linked-store.mjs pack [--prune] [--from dirs] | unpack | stats'); process.exit(2); }
}
