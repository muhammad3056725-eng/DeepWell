#!/usr/bin/env node
// Offline data improvement for packs already in data/ (no network needed):
//  1. re-clean every pack with the current rules (more accepted spellings, duplicates and blocklisted entries removed);
//  2. fold answers that only exist in "starts with <letter>" packs back into the base pack (up to its target), so
//     "Name a bird" accepts every bird we know, not just the first thousand;
//  3. enforce `notParent` (reptile must not contain birds) on base and letter packs;
//  4. re-apply data/overrides.json and guarantee anchors.
// Then run `node scripts/backfill-manifest.mjs` and bump manifest.version. Usage: node scripts/enrich-packs.mjs [--dry]
import { existsSync, readdirSync } from 'node:fs';
if (!existsSync('data/packs') || !readdirSync('data/packs').some(f => f.endsWith('.json'))) {
  console.error('No loose packs in data/packs/. The site data is stored linked: run `node scripts/linked-store.mjs unpack` first, and `node scripts/linked-store.mjs pack` afterwards.');
  process.exit(1);
}
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { CATALOG } from '../js/catalog.js';
import { fromPack, toPack } from '../js/wikidata.js';
import { cleanPool, applyOverrides, ensureAnchors, checkAnchors } from './data-quality.mjs';
const DRY = process.argv.includes('--dry');
const json = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
const [anchors, overrides, blocklist] = await Promise.all([json('data/anchors.json', {}), json('data/overrides.json', {}), json('data/blocklist.json', { qids: [], words: [] })]);
const byId = new Map(CATALOG.map(e => [e.id, e]));
const files = (await readdir('data/packs')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
const raw = new Map(), packs = new Map();
for (const id of files) { raw.set(id, await json(`data/packs/${id}.json`)); packs.set(id, fromPack(raw.get(id))); }
const baseOf = id => id.replace(/-starts-[a-z]$/, '');
const letterPacks = new Map();   // base id -> [letter pack ids]
for (const id of files) if (/-starts-[a-z]$/.test(id)) { const b = baseOf(id); if (packs.has(b)) (letterPacks.get(b) || letterPacks.set(b, []).get(b)).push(id); }
// ids that belong to the excluded family (e.g. every bird id, base + letter packs)
const familyIds = parent => { const out = new Set(); for (const [id, items] of packs) { const e = byId.get(id); if (e && e.parent === parent) for (const i of items) out.add(i.id); } return out; };
const excluded = new Map();
for (const e of CATALOG) if (e.notParent && !excluded.has(e.notParent)) excluded.set(e.notParent, familyIds(e.notParent));
const stats = { packs: 0, changed: 0, added: 0, removed: 0, aliasesBefore: 0, aliasesAfter: 0, byPack: {} };
for (const id of files) {
  const e = byId.get(id); if (!e) continue;
  let items = packs.get(id);
  const before = items;
  if (!/-starts-[a-z]$/.test(id) && letterPacks.has(id)) {            // fold letter-pack answers into the base pack
    const seen = new Set(items.map(i => i.id));
    items = [...items]; for (const lp of letterPacks.get(id)) for (const i of packs.get(lp)) if (!seen.has(i.id)) { seen.add(i.id); items.push(i); }
  }
  if (e.notParent) { const ex = excluded.get(e.notParent); items = items.filter(i => !ex.has(i.id)); }
  const cleaned = cleanPool(items, e, blocklist).items;
  const rule = { ...(anchors[e.id] || {}), people: Boolean(e.people) };
  const target = e.target ?? e.answerLimit ?? 2000;
  let out = applyOverrides(id, cleaned, overrides).slice(0, target);
  out = ensureAnchors(out, rule, id).items.slice(0, target);
  if (checkAnchors(out, rule).missing.length) { console.error('ANCHOR STILL FAILING', id); process.exitCode = 1; }
  stats.packs++;
  const same = JSON.stringify(before) === JSON.stringify(out);
  const al = x => x.reduce((s, i) => s + (i.a?.length || 0), 0);
  stats.aliasesBefore += al(before); stats.aliasesAfter += al(out);
  if (same) continue;
  stats.changed++; stats.added += Math.max(0, out.length - before.length); stats.removed += Math.max(0, before.length - out.length);
  if (Math.abs(out.length - before.length) >= 25) stats.byPack[id] = `${before.length} -> ${out.length}`;
  if (!DRY) await writeFile(`data/packs/${id}.json`, JSON.stringify({ ...toPack(e, out), built: raw.get(id).built }));
}
console.log(JSON.stringify(stats, null, 1));
if (!DRY) {
  const m = await json('data/manifest.json', {}); m.version = (m.version || 0) + 1; m.built = new Date().toISOString().slice(0, 10);
  await writeFile('data/manifest.json', JSON.stringify(m)); console.log('Manifest version', m.version, '- now run scripts/backfill-manifest.mjs');
}
