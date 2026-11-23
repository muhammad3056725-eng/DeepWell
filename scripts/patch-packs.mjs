#!/usr/bin/env node
// Offline repair of the packs already in data/: re-clean, apply data/overrides.json, and guarantee the anchors
// (famous answers) through the real matcher. Needs no network. Run this, then `node scripts/backfill-manifest.mjs`.
// Usage: node scripts/patch-packs.mjs [--only a,b,c] [--all]
import { readFile, writeFile } from 'node:fs/promises';
import { CATALOG } from '../js/catalog.js';
import { fromPack, toPack } from '../js/wikidata.js';
import { cleanPool, applyOverrides, ensureAnchors, checkAnchors } from './data-quality.mjs';
const args = process.argv.slice(2), opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const json = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
const [anchors, overrides, blocklist] = await Promise.all([json('data/anchors.json', {}), json('data/overrides.json', {}), json('data/blocklist.json', { qids: [], words: [] })]);
const only = opt('only') ? new Set(opt('only').split(',')) : null;
const targets = CATALOG.filter(e => only ? only.has(e.id) : (anchors[e.id] || overrides[e.id] || (args.includes('--all') && e.cat === 'Geography')));
let changed = 0; const injectedAll = {};
for (const e of targets) {
  let pack; try { pack = JSON.parse(await readFile(`data/packs/${e.id}.json`, 'utf8')); } catch { continue; }
  const old = fromPack(pack);
  const rule = { ...(anchors[e.id] || {}), people: Boolean(e.people) };
  const cleaned = cleanPool(old, e, blocklist);
  const merged = applyOverrides(e.id, cleaned.items, overrides);
  const { items, injected } = ensureAnchors(merged, rule, e.id);
  const final = items.slice(0, e.target ?? 2000), check = checkAnchors(final, rule);
  if (check.missing.length || check.forbidden.length) { console.error('STILL FAILING', e.id, JSON.stringify(check)); process.exitCode = 1; }
  if (injected.length) injectedAll[e.id] = injected.map(x => x.anchor);
  // Rewrite only where it matters (a famous answer was missing or rejected, an override applies, or it is a place pool
  // whose aliases the old 12-alias cap truncated). Other packs stay byte-for-byte, so git history does not bloat.
  const needs = injected.length || overrides[e.id] || e.cat === 'Geography' || checkAnchors(old, rule).missing.length;
  if (!needs || JSON.stringify(old) === JSON.stringify(final)) continue;
  await writeFile(`data/packs/${e.id}.json`, JSON.stringify({ ...toPack(e, final), built: pack.built || new Date().toISOString().slice(0, 10) }));
  changed++;
}
console.log(`Patched ${changed} of ${targets.length} packs.`);
console.log('Anchors that had to be added by hand (the Wikidata query had missed them):');
console.log(JSON.stringify(injectedAll, null, 1));
