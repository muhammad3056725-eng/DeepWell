// Validates the answer data the site serves: node scripts/validate-data.mjs
// Checks every question against the v4 linked store (data/linked) or a loose pack, the blocklist, popularity order,
// anchors through the real game matcher, file hashes, and that every answer is stored exactly once.
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeDataName, checkAnchors } from './data-quality.mjs';
import { fromPack } from '../js/wikidata.js';
import { CATALOG } from '../js/catalog.js';
import { readAnyPrompt } from './linked-store.mjs';

const errors = [], manifest = JSON.parse(await readFile('data/manifest.json', 'utf8'));
const block = JSON.parse(await readFile('data/blocklist.json', 'utf8')), anchors = JSON.parse(await readFile('data/anchors.json', 'utf8'));
const catalog = new Set(CATALOG.map(e => e.id));
const loose = (await readdir('data/packs').catch(() => [])).filter(f => f.endsWith('.json'));
const sha16 = raw => createHash('sha256').update(raw).digest('hex').slice(0, 16);
let total = 0, anchorTotal = 0;

for (const [id, meta] of Object.entries(manifest.packs)) {
  try {
    const items = await readAnyPrompt(manifest, id);
    if (!items) throw new Error('answers missing');
    if (items.length !== meta.n) errors.push(`${id}: manifest answer count mismatch (${items.length} vs ${meta.n})`);
    if (meta.kind !== 'curated' && !catalog.has(id)) errors.push(`${id}: Wikidata question is not in js/catalog.js`);
    if (meta.kind === 'curated' && !meta.prompt) errors.push(`${id}: curated question has no prompt text`);
    const seen = new Set();
    for (let i = 0; i < items.length; i++) {
      const x = items[i], key = normalizeDataName(x.n);
      if (!x.n || !String(x.n).trim()) errors.push(id + ': empty name');
      if (seen.has(key)) errors.push(id + ': duplicate normalized name ' + x.n); seen.add(key);
      if (i && items[i].s > items[i - 1].s) errors.push(id + ': not popularity sorted');
      if ((block.qids || []).includes(x.id) || (block.words || []).some(w => String(x.n).toLowerCase().includes(String(w).toLowerCase()))) errors.push(id + ': blocklist violation ' + x.n);
    }
    const rule = anchors[id] || {};
    if (rule.anchors?.length || rule.mustNot?.length) {
      const res = checkAnchors(items, rule);
      for (const x of res.missing) errors.push(id + ': ANCHOR REJECTED BY GAME MATCHER: ' + x);
      for (const x of res.forbidden) errors.push(id + ': mustNot answer accepted: ' + x);
      anchorTotal += (rule.anchors || []).length;
    }
    if (meta.qhash) {
      const raw = await readFile(`data/linked/q/${id}.json`, 'utf8'); total += Buffer.byteLength(raw);
      if (sha16(raw) !== meta.qhash) errors.push(`${id}: question index hash mismatch`);
    }
  } catch (e) { errors.push(id + ': ' + e.message); }
}
for (const file of loose) if (!manifest.packs[file.slice(0, -5)]) errors.push(file + ': loose pack missing from manifest');

// v4 store: chunk files match the manifest, and no answer id appears twice.
if (manifest.store?.v === 4) {
  const listed = new Set(), ids = new Set();
  for (let i = 0; i < manifest.store.chunks.length; i++) {
    const name = `e.${i}.json`; listed.add(name);
    try {
      const raw = await readFile('data/linked/' + name, 'utf8'); total += Buffer.byteLength(raw);
      if (sha16(raw) !== manifest.store.chunks[i].hash) errors.push(name + ': hash mismatch');
      if (Buffer.byteLength(raw) > 256 * 1024) errors.push(name + ': chunk larger than 256 KB');
      for (const id of JSON.parse(raw).ids) { if (ids.has(id)) errors.push(`${name}: answer ${id} is stored twice`); ids.add(id); }
    } catch (e) { errors.push(name + ': ' + e.message); }
  }
  for (const f of await readdir('data/linked').catch(() => [])) if (f.endsWith('.json') && !listed.has(f)) errors.push('data/linked/' + f + ': chunk not listed in the manifest');
  if (ids.size !== manifest.store.entities) errors.push(`store entity count mismatch (${ids.size} vs ${manifest.store.entities})`);
}
if (total > 60 * 1024 * 1024) errors.push('total data bytes exceed 60 MiB budget');
for (const id of Object.keys(anchors)) if (!catalog.has(id) && !manifest.packs[id]) errors.push('anchor prompt is not in catalog: ' + id);
if (errors.length) { console.error('Validation failed:\n' + errors.slice(0, 200).join('\n') + (errors.length > 200 ? `\n... ${errors.length - 200} more` : '')); process.exit(1); }
console.log(`Anchors checked through the game matcher: ${anchorTotal}`);
console.log(`Validation passed: ${Object.keys(manifest.packs).length} questions, ${manifest.store?.entities?.toLocaleString() ?? '?'} answers stored once, ${total.toLocaleString()} raw bytes.`);
