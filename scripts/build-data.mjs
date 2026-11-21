#!/usr/bin/env node
// Build data/packs/*.json + data/manifest.json from Wikidata.
//   node scripts/build-data.mjs                 build everything (about 30-60 min, polite rate)
//   node scripts/build-data.mjs --only river,lake,film   build specific prompt ids
//   node scripts/build-data.mjs --resume         skip packs built in the last 6 days
//   node scripts/build-data.mjs --verify-only    only check that catalog Q-ids match their labels
// Runs in GitHub Actions weekly (.github/workflows/build-data.yml) and commits the result.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CATALOG, ENTITY_LABELS, entityIdsOf } from '../js/catalog.js';
import { buildQuery, buildLabelQuery, parseBindings, queryUrl, toPack } from '../js/wikidata.js';

const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt('out', 'data/packs'));
const MANIFEST = path.resolve(opt('manifest', 'data/manifest.json'));
const ONLY = opt('only') ? new Set(opt('only').split(',')) : null;
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'DeepwellBuild/2.0 (https://deepwell.games; static trivia game data build)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sparql(query, tries = 4) {
  for (let t = 1; t <= tries; t++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 70000);
      const res = await fetch(queryUrl(ENDPOINT, query).replace('&origin=*', ''), {
        signal: ctrl.signal,
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        const wait = (Number(res.headers.get('retry-after')) || 8 * t) * 1000;
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (t === tries) throw e;
      await sleep(4000 * t);
    }
  }
  throw new Error('unreachable');
}

async function verifyIds() {
  const ids = [...ENTITY_LABELS.keys()];
  const labels = new Map();
  for (let i = 0; i < ids.length; i += 80) {
    const json = await sparql(buildLabelQuery(ids.slice(i, i + 80)));
    for (const b of json.results.bindings) labels.set(b.q.value.split('/').pop(), b.l.value.toLowerCase());
  }
  const bad = new Set();
  for (const [q, expect] of ENTITY_LABELS) {
    const got = labels.get(q);
    if (!got || !(got.includes(expect) || expect.includes(got))) {
      bad.add(q);
      console.warn(`  ID MISMATCH ${q}: expected "${expect}", Wikidata says "${got ?? 'none'}"`);
    }
  }
  return bad;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Catalog: ${CATALOG.length} prompts, ${ENTITY_LABELS.size} Q-ids`);
  console.log('Verifying Q-ids against Wikidata labels...');
  const badIds = await verifyIds();
  console.log(badIds.size ? `${badIds.size} bad ids: affected prompts will be skipped.` : 'All ids verified.');
  if (flag('verify-only')) return process.exit(badIds.size ? 1 : 0);

  let manifest = { version: 0, built: null, packs: {} };
  try { manifest = JSON.parse(await readFile(MANIFEST, 'utf8')); } catch { /* first run */ }
  const report = { skipped: [], failed: [], built: 0 };
  const today = new Date().toISOString().slice(0, 10);

  const todo = CATALOG.filter(e => !ONLY || ONLY.has(e.id));
  let n = 0;
  for (const entry of todo) {
    n++;
    const tag = `[${n}/${todo.length}] ${entry.id}`;
    if (entityIdsOf(entry).some(q => badIds.has(q))) { report.skipped.push(entry.id + ' (bad id)'); console.log(`${tag}: skipped, bad id`); continue; }
    const prev = manifest.packs[entry.id];
    if (flag('resume') && prev && prev.built && (Date.parse(today) - Date.parse(prev.built)) < 6 * 864e5) { console.log(`${tag}: fresh, skipped`); continue; }
    try {
      const json = await sparql(buildQuery(entry));
      const items = parseBindings(json, entry);
      const minimumItems = Math.min(entry.minPool || 20, 8);
      const previousCount = prev?.n || 0;
      if (items.length < minimumItems) {
        report.skipped.push(`${entry.id} (only ${items.length} answers; needs ${minimumItems})`);
        console.log(`${tag}: only ${items.length} answers; keeping previous pack if one exists`);
        // A thin refresh must never remove a previously working answer pool.
      } else if (previousCount > items.length) {
        report.skipped.push(`${entry.id} (new pool ${items.length} smaller than existing ${previousCount})`);
        console.log(`${tag}: new pool smaller than existing; keeping ${previousCount}-answer pack`);
      } else {
        await writeFile(path.join(OUT, entry.id + '.json'), JSON.stringify(toPack(entry, items)));
        manifest.packs[entry.id] = { n: items.length, built: today };
        report.built++;
        console.log(`${tag}: ${items.length} answers`);
      }
    } catch (e) {
      report.failed.push(`${entry.id}: ${e.message}`);
      console.warn(`${tag}: FAILED ${e.message}`);
    }
    await sleep(1500); // be polite to the public endpoint
  }

  manifest.version = (manifest.version || 0) + 1;
  manifest.built = today;
  await mkdir(path.dirname(MANIFEST), { recursive: true });
  await writeFile(MANIFEST, JSON.stringify(manifest));
  const total = Object.values(manifest.packs).reduce((s, p) => s + p.n, 0);
  console.log(`\nDone. ${report.built} packs built, ${Object.keys(manifest.packs).length} in manifest, ${total} answers total.`);
  if (report.skipped.length) console.log('Skipped:\n  ' + report.skipped.join('\n  '));
  if (report.failed.length) console.log('Failed:\n  ' + report.failed.join('\n  '));
  // Fail the job only if nothing worked at all, so one bad query never blocks a deploy.
  if (!Object.keys(manifest.packs).length) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
