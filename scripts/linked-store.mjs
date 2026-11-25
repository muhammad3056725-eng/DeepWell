#!/usr/bin/env node
// Converts between the two on-disk layouts of the answer data:
//   loose   data/packs/<question>.json        one file per question (what build/patch/enrich scripts work on)
//   linked  data/linked/<shard>.<n>.json      shared answer rows, many questions per row (what the site serves)
//
//   node scripts/linked-store.mjs unpack   linked -> loose   (run before build-data / patch-packs / enrich-packs)
//   node scripts/linked-store.mjs pack     loose  -> linked  (run after them; loose files are removed)
//   node scripts/linked-store.mjs pack --prune   also drop questions that are no longer in js/catalog.js
//   node scripts/linked-store.mjs stats    sizes and sharing figures
//
// `pack` is idempotent: running it twice (or unpack then pack) writes byte-identical chunk files.
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fromPack, toPack, ANSWER_CAP } from '../js/wikidata.js';
import { CATALOG } from '../js/catalog.js';
import { planShards, packShard, chunkRows, itemsForBit, LINKED_DIR } from '../js/linked.js';

const MANIFEST = 'data/manifest.json', LOOSE = 'data/packs';
const sha = v => createHash('sha256').update(v).digest('hex');
const readJson = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
const today = () => new Date().toISOString().slice(0, 10);

/** Answers of one question from the linked store (used by validators and tools). */
export async function readLinkedPrompt(manifest, id, dir = '.') {
  const meta = manifest.packs[id];
  if (!meta?.shard) return null;
  const rows = [];
  for (const i of meta.chunks || []) rows.push(...chunkRows(JSON.parse(await readFile(`${dir}/${LINKED_DIR}/${meta.shard}.${i}.json`, 'utf8'))));
  return itemsForBit(rows, meta.bit || 0);
}

/** A question's answers from whichever layout holds them: [{id,n,s,a}] or null. */
export async function readAnyPrompt(manifest, id) {
  const loose = await readJson(`${LOOSE}/${id}.json`, null);
  if (loose) return fromPack(loose);
  return readLinkedPrompt(manifest, id);
}

async function unpack() {
  const manifest = await readJson(MANIFEST, { packs: {} });
  await mkdir(LOOSE, { recursive: true });
  let n = 0;
  for (const [id, meta] of Object.entries(manifest.packs)) {
    if (!meta.shard) continue;
    const items = await readLinkedPrompt(manifest, id);
    const pack = toPack({ id, target: ANSWER_CAP }, items);
    pack.built = meta.built || manifest.built || today();
    await writeFile(`${LOOSE}/${id}.json`, JSON.stringify(pack));
    n++;
  }
  console.log(`Unpacked ${n} questions into ${LOOSE}/ (linked files are kept until the next pack).`);
}

async function pack() {
  const manifest = await readJson(MANIFEST, { version: 0, built: null, packs: {} });
  manifest.shards = manifest.shards || {};
  const loose = (await readdir(LOOSE).catch(() => [])).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  const pools = new Map(), builtOf = new Map();
  for (const id of loose) {
    const raw = await readJson(`${LOOSE}/${id}.json`, null);
    if (!raw) continue;
    pools.set(id, fromPack(raw)); builtOf.set(id, raw.built);
  }
  for (const [id, meta] of Object.entries(manifest.packs)) {
    if (pools.has(id) || !meta.shard) continue;
    pools.set(id, await readLinkedPrompt(manifest, id));   // untouched questions come from the existing chunks
  }
  if (process.argv.includes('--prune')) {
    const live = new Set(CATALOG.map(e => e.id)); let dropped = 0;
    for (const id of [...pools.keys()]) if (!live.has(id)) { pools.delete(id); delete manifest.packs[id]; dropped++; }
    console.log(`Pruned ${dropped} questions that are no longer in the catalog.`);
  }
  const plan = planShards([...pools.keys()]);
  await mkdir(LINKED_DIR, { recursive: true });
  const oldShards = manifest.shards, newShards = {}, keep = new Set();
  for (const [shardId, ids] of plan) {
    const sub = new Map(ids.map(id => [id, pools.get(id)]));
    const packed = packShard(shardId, sub), files = [];
    packed.chunks.forEach((chunk, i) => {
      const raw = JSON.stringify(chunk), name = `${shardId}.${i}.json`;
      files.push({ n: chunk.ids.length, hash: sha(raw), bytes: Buffer.byteLength(raw), name, raw });
      keep.add(name);
    });
    const prev = oldShards[shardId], same = prev && prev.chunks.length === files.length && prev.chunks.every((c, i) => c.hash === files[i].hash);
    for (const f of files) {
      const path = `${LINKED_DIR}/${f.name}`;
      if (!same) await writeFile(path, f.raw);
    }
    newShards[shardId] = { prompts: packed.prompts, chunks: files.map(({ n, hash, bytes }) => ({ n, hash, bytes })), built: same ? prev.built : today() };
    packed.prompts.forEach((id, bit) => {
      const old = manifest.packs[id] || {}, { hash, bytes, ...rest } = old, pp = packed.perPrompt[id];
      manifest.packs[id] = { ...rest, n: pp.n, built: builtOf.get(id) || old.built || manifest.built || today(), source: old.source || 'wikidata', shard: shardId, bit, chunks: pp.chunks };
    });
  }
  // remove chunk files that no longer belong to any shard, and the loose files we just folded in
  for (const f of await readdir(LINKED_DIR).catch(() => [])) if (f.endsWith('.json') && !keep.has(f)) await rm(`${LINKED_DIR}/${f}`);
  for (const id of loose) await rm(`${LOOSE}/${id}.json`);
  manifest.shards = newShards;
  await writeFile(MANIFEST, JSON.stringify(manifest));
  const chunks = Object.values(newShards).reduce((s, x) => s + x.chunks.length, 0);
  console.log(`Packed ${pools.size} questions into ${Object.keys(newShards).length} shards / ${chunks} chunk files.`);
}

async function stats() {
  const manifest = await readJson(MANIFEST, { packs: {}, shards: {} });
  let raw = 0, gz = 0, rows = 0, files = 0;
  for (const f of await readdir(LINKED_DIR).catch(() => [])) {
    const t = await readFile(`${LINKED_DIR}/${f}`, 'utf8'); raw += t.length; gz += gzipSync(t).length; files++;
    rows += JSON.parse(t).ids.length;
  }
  const memberships = Object.values(manifest.packs).reduce((s, p) => s + (p.n || 0), 0);
  console.log({ questions: Object.keys(manifest.packs).length, shards: Object.keys(manifest.shards || {}).length, chunkFiles: files,
    answerRows: rows, memberships, avgQuestionsPerRow: (memberships / Math.max(1, rows)).toFixed(2),
    rawMB: (raw / 1e6).toFixed(2), gzMB: (gz / 1e6).toFixed(2), bytesPerMembershipGz: (gz / Math.max(1, memberships)).toFixed(1) });
}

const cmd = process.argv[2];
if (import.meta.url === `file://${process.argv[1]}`) {
  if (cmd === 'pack') await pack();
  else if (cmd === 'unpack') await unpack();
  else if (cmd === 'stats') await stats();
  else { console.error('usage: linked-store.mjs pack | unpack | stats'); process.exit(2); }
}
