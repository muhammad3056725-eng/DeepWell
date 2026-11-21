// Offline self-test: node scripts/selftest.mjs
// Checks the catalog, query builder, matching, rarity and seeded picking. No network needed.
import { CATALOG, ENTITY_LABELS, entityIdsOf } from '../js/catalog.js';
import { buildQuery, parseBindings, toPack, fromPack } from '../js/wikidata.js';
import {
  normalize, matchAnswer, buildPool, assignRarity, pickEntries, mulberry32, hashString,
  letterOptions, deriveLetterPool, blendPoints, tier, previousUtcDate,
} from '../js/engine.js';
import { SEED } from '../js/seed.js';
import { parseSeed } from '../js/data.js';

let failed = 0, passed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL:', msg); } }
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);

// ---- catalog
const ids = new Set();
for (const e of CATALOG) {
  ok(!ids.has(e.id), 'duplicate id ' + e.id); ids.add(e.id);
  ok(e.prompt && e.pattern && e.cat, 'incomplete entry ' + e.id);
  ok(/^[a-z0-9-]+$/.test(e.id), 'bad id chars ' + e.id);
  ok(entityIdsOf(e).every(q => ENTITY_LABELS.has(q)), 'unregistered Q-id in ' + e.id);
}
ok(CATALOG.length >= 400, 'catalog has 400+ entries, has ' + CATALOG.length);

// ---- queries
const item = CATALOG.find(e => e.kind === 'item'), taxon = CATALOG.find(e => e.kind === 'taxon');
const programmingEntry = CATALOG.find(e => e.id === 'programming-language');
ok(programmingEntry?.pattern.includes('P279*'), 'programming language query includes subclasses');
ok(programmingEntry?.limit >= 5000, 'programming language query fetches a larger pool');
ok(/SELECT/.test(buildQuery(item)) && /sitelinks/.test(buildQuery(item)), 'item query');
ok(/P1843/.test(buildQuery(taxon)), 'taxon query uses common names');
const rows = { results: { bindings: [
  { item: { value: 'http://www.wikidata.org/entity/Q1' }, itemLabel: { value: 'Alpha' }, sl: { value: '100' }, alts: { value: 'Alef|Alpha' } },
  { item: { value: 'http://www.wikidata.org/entity/Q2' }, itemLabel: { value: 'Q99999' }, sl: { value: '50' }, alts: { value: '' } },
  { item: { value: 'http://www.wikidata.org/entity/Q3' }, itemLabel: { value: 'Alpha' }, sl: { value: '40' }, alts: { value: '' } },
  { item: { value: 'http://www.wikidata.org/entity/Q4' }, itemLabel: { value: 'Beta' }, sl: { value: '10' }, alts: { value: '' } },
] } };
const parsed = parseBindings(rows, item);
eq(parsed.length, 2, 'parse drops unlabeled and duplicate names');
eq(parsed[0].a.join(), 'Alef', 'alias deduped against the label');
eq(fromPack(toPack(item, parsed))[1].n, 'Beta', 'pack round trip');

// ---- normalising and matching
eq(normalize('  The Café-Au-Lait! '), 'cafe au lait', 'normalize accents, article, punctuation');
eq(normalize('Ørsted & Søn'), 'orsted and son', 'normalize ø and &');
const raw = ['Vistula', 'Danube', 'Rhine', 'Elbe', 'Oder', 'Seine', 'Loire', 'Thames', 'Tiber', 'Po'].map((n, i) => ({ id: 'Q' + i, n, s: 100 - i * 9, a: n === 'Danube' ? ['Donau'] : [] }));
const pool = buildPool(raw);
const languages = buildPool([
  { id: 'Q1', n: 'C', s: 100, a: [] },
  { id: 'Q2', n: 'C++', s: 90, a: ['C plus plus'] },
  { id: 'Q3', n: 'C#', s: 80, a: ['C sharp'] },
  { id: 'Q4', n: 'F#', s: 70, a: ['F sharp'] },
]);
eq(normalize('C++'), 'c++', 'normalise C++ without losing plus signs');
eq(normalize('C#'), 'c#', 'normalise C# without losing hash');
eq(matchAnswer('C', languages)?.item.n, 'C', 'C matches only C');
eq(matchAnswer('C++', languages)?.item.n, 'C++', 'C++ remains distinct from C');
eq(matchAnswer('C#', languages)?.item.n, 'C#', 'C# remains distinct from C');
eq(matchAnswer('C plus plus', languages)?.item.n, 'C++', 'spoken C plus plus alias matches C++');
eq(matchAnswer('C sharp', languages)?.item.n, 'C#', 'spoken C sharp alias matches C#');
ok(matchAnswer('rhine', pool)?.exact, 'exact match ignores case');
eq(matchAnswer('Donau', pool)?.item.n, 'Danube', 'alias match');
ok(matchAnswer('Vistla', pool)?.near, 'one-letter typo is a near match');
eq(matchAnswer('xyz', pool), null, 'nonsense does not match');
eq(matchAnswer('Rhin', pool)?.near, undefined, 'short fuzzy inputs are not guessed');
const people = buildPool([{ id: 'Q1', n: 'Albert Einstein', s: 90, a: [] }, { id: 'Q2', n: 'Isaac Newton', s: 80, a: [] }], { people: true });
eq(matchAnswer('Einstein', people)?.item.n, 'Albert Einstein', 'unique surname matches a person');

// ---- rarity
const ranked = assignRarity([{ s: 100 }, { s: 80 }, { s: 50 }, { s: 10 }, { s: 5 }]);
eq(ranked[0].r, 3, 'best-known answer is worth about 3'); eq(ranked[4].r, 100, 'rarest answer is worth 100');
ok(ranked.every((x, i, a) => i === 0 || x.r >= a[i - 1].r), 'rarity rises as fame falls');
eq(assignRarity([{ s: 7 }, { s: 7 }, { s: 7 }])[0].r, assignRarity([{ s: 7 }, { s: 7 }, { s: 7 }])[2].r, 'ties share a score');
eq(tier(3), 'Common', 'tier common'); eq(tier(100), 'Singular', 'tier singular');
eq(blendPoints(40, { count: 1, total: 5 }).crowdUsed, false, 'crowd ignored below min samples');
ok(blendPoints(40, { count: 1, total: 200 }, { weight: 1 }).points > 85, 'crowd: a very rare answer scores high');

// ---- letters
const big = buildPool(Array.from({ length: 60 }, (_, i) => ({ id: 'Q' + i, n: (i % 2 ? 'Ma' : 'Be') + i, s: 100 - i, a: [] })));
eq(letterOptions(big, 14).join(), 'B,M', 'letter options');
eq(deriveLetterPool(big, 'M').size, 30, 'letter sub-pool');

// ---- seeded picking is deterministic and spreads categories
const seedA = hashString('deepwell-daily-2026-01-01');
const pick = () => pickEntries(CATALOG, 7, mulberry32(seedA)).map(p => p.entry.id).join();
eq(pick(), pick(), 'same seed gives same prompts');
ok(pick() !== pickEntries(CATALOG, 7, mulberry32(hashString('x'))).map(p => p.entry.id).join(), 'different seed differs');
eq(new Set(pickEntries(CATALOG, 7, mulberry32(5)).map(p => p.entry.cat)).size, 7, 'seven prompts span seven categories');
eq(previousUtcDate('2026-03-01'), '2026-02-28', 'previous UTC date');

// ---- seed lists
const byId = new Map(CATALOG.map(e => [e.id, e]));
for (const id of Object.keys(SEED)) {
  ok(byId.has(id), 'seed id not in catalog: ' + id);
  const items = byId.has(id) ? parseSeed(byId.get(id)) : [];
  ok(items.length >= 8, `seed ${id} has 8+ items (${items.length})`);
}

console.log(`${passed} passed, ${failed} failed. ${CATALOG.length} prompts, ${Object.keys(SEED).length} seed lists.`);
process.exit(failed ? 1 : 0);
