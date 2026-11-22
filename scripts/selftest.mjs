// Offline self-test: node scripts/selftest.mjs
// Checks the catalog, query builder, matching, rarity and seeded picking. No network needed.
import { CATALOG, ENTITY_LABELS, entityIdsOf, QUESTION_TARGET } from '../js/catalog.js';
import { buildQuery, parseBindings, toPack, fromPack, mergePools } from '../js/wikidata.js';
import {
  normalize, matchAnswer, buildPool, assignRarity, pickEntries, mulberry32, hashString,
  letterOptions, deriveLetterPool, blendPoints, tier, previousUtcDate,
} from '../js/engine.js';
import { SEED } from '../js/seed.js';
import { parseSeed } from '../js/data.js';
import { cleanPool, applyOverrides, meaningfulChange } from './data-quality.mjs';

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
eq(CATALOG.length, QUESTION_TARGET, 'catalog reaches configured question target');
eq(CATALOG.length, 10000, 'catalog has exactly 10,000 unique prompts');
eq(new Set(CATALOG.map(e => e.prompt)).size, CATALOG.length, 'all prompt texts are unique');
ok(CATALOG.every(e => (e.target ?? e.answerLimit ?? 2000) <= 2000), 'no prompt allows more than 1,000 answers');
const foodF = CATALOG.find(e => e.id === 'food-starts-f');
eq(foodF?.prompt, 'Name a food starting with F', 'food starting with F is included');
eq(foodF?.answerLimit, 2000, 'food F can use up to 1,000 answers');
const elementEntry = CATALOG.find(e => e.id === 'chemical-element');
eq(elementEntry?.answerLimit, 118, 'chemical elements keep their natural 118-answer ceiling');

// ---- queries
const item = CATALOG.find(e => e.kind === 'item'), taxon = CATALOG.find(e => e.kind === 'taxon');
const programmingEntry = CATALOG.find(e => e.id === 'programming-language');
ok(programmingEntry?.pattern.includes('P279*'), 'programming language query includes subclasses');
ok(programmingEntry?.limit >= 5000, 'programming language query fetches a larger pool');
ok(/SELECT/.test(buildQuery(item)) && /sitelinks/.test(buildQuery(item)), 'item query');
ok(/LIMIT 5000/.test(buildQuery(programmingEntry)), 'programming-language candidate search has a 5,000-row limit');
ok(/LIMIT 5000 OFFSET 5000/.test(buildQuery(programmingEntry,{limit:5000,minSL:1,offset:5000})), 'scheduled candidate pages advance by 5,000 records');
ok(/LIMIT 2000$/.test(buildQuery(programmingEntry)), 'programming-language answer pool is capped at 1,000');
ok(buildQuery(foodF, { limit: 5000, minSL: 1 }).includes('STRSTARTS(LCASE(STR(?itemLabel)), "f")'), 'food F query filters labels by F');
const foodFQuery = buildQuery(foodF, { limit: 5000, minSL: 1 });
ok(foodFQuery.indexOf('STRSTARTS') < foodFQuery.indexOf('LIMIT 5000'), 'food F prefix is applied before candidate truncation');
const insectA = { ...taxon, startsWith: 'A' };
const insectAQuery = buildQuery(insectA, { limit: 5000, minSL: 1 });
ok(insectAQuery.includes('STRSTARTS(LCASE(STR(?filterName)), "a")'), 'taxon letter filtering is applied to common names before candidate limit');
ok(insectAQuery.indexOf('STRSTARTS') < insectAQuery.indexOf('LIMIT 5000'), 'taxon prefix is applied before candidate truncation');
ok(/LIMIT 1000$/.test(buildQuery(foodF, { limit: 5000, minSL: 1 })), 'food F query returns no more than 1,000 answers');
ok(/LIMIT 118$/.test(buildQuery(elementEntry)), 'chemical-element query respects its 118-answer limit');

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
eq(toPack(item, parsed).v, 2, 'new packs use v2');
eq(fromPack(toPack(item, parsed))[1].n, 'Beta', 'v2 pack round trip');
eq(fromPack({v:1,items:[[1,'Legacy',20,['Old name']]]})[0].a[0], 'Old name', 'v1 pack compatibility');
const manyRows = { results: { bindings: Array.from({ length: 1100 }, (_, i) => ({
  item: { value: `http://www.wikidata.org/entity/Q${10000 + i}` },
  itemLabel: { value: `Answer ${i}` }, sl: { value: String(1100 - i) }, alts: { value: '' },
})) } };
eq(parseBindings(manyRows, item).length, 1100, 'parser supports pools larger than 1,000');
const accumulated = mergePools(
  [{id:'Q101',n:'Old answer',s:80,a:['Old alias']},{id:'Q102',n:'Shared answer',s:70,a:[]}],
  [{id:'Q102',n:'Shared answer',s:75,a:['New alias']},{id:'Q103',n:'New answer',s:90,a:[]}],
  {answerLimit:1000},
);
eq(accumulated.length,3,'scheduled refresh accumulates saved and new records');
eq(accumulated.find(x=>x.id==='Q102')?.s,75,'refresh updates popularity metadata');
ok(accumulated.find(x=>x.id==='Q102')?.a.includes('New alias'),'refresh adds aliases');
const capped=mergePools(Array.from({length:1000},(_,i)=>({id:'Q'+(2000+i),n:'Entry '+i,s:2000-i,a:[]})),[{id:'Q9999',n:'New entry',s:9999,a:[]}],{answerLimit:1000});
eq(capped.length,1000,'cumulative merge never exceeds 1,000 answers');
const filtered=mergePools([{id:'Q1',n:'Apple pie',s:20,a:[]}],[{id:'Q2',n:'Falafel',s:10,a:[]}],{startsWith:'F'});
eq(filtered.length,1,'letter-prompt merge excludes labels outside requested letter');

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
const recentIds = new Set(pickEntries(CATALOG, 80, mulberry32(23)).map(p => p.entry.id));
const freshPicks = pickEntries(CATALOG, 7, mulberry32(24), { avoid: recentIds });
ok(freshPicks.every(p => !recentIds.has(p.entry.id)), 'fresh dive avoids recently used question IDs when enough remain');
eq(previousUtcDate('2026-03-01'), '2026-02-28', 'previous UTC date');

// ---- seed lists
const byId = new Map(CATALOG.map(e => [e.id, e]));
for (const id of Object.keys(SEED)) {
  ok(byId.has(id), 'seed id not in catalog: ' + id);
  const items = byId.has(id) ? parseSeed(byId.get(id)) : [];
  ok(items.length >= 8, `seed ${id} has 8+ items (${items.length})`);
}

// ---- dataset quality pipeline
const bandQuery = buildQuery(item, { minSL: 100, maxSL: 199, target: 2000 });
ok(bandQuery.includes('FILTER(?sl >= 100)') && bandQuery.includes('FILTER(?sl <= 199)'), 'popularity band query has inclusive floor and ceiling');
const quality = cleanPool([
 {id:'Q1',n:'Alpha River',s:100,a:['Shared alias','Alfa']},
 {id:'Q2',n:'Beta River',s:40,a:['Shared alias']},
 {id:'Q3',n:'Alpha  River',s:20,a:[]},
 {id:'Q4',n:'List of rivers',s:90,a:[]},
 {id:'Q5',n:'Blocked place',s:80,a:[]},
 {id:'Q6',n:'Deutschland',s:70,a:['Deutschland']},
], {cat:'Geography'}, {qids:[],words:['blocked place']});
eq(quality.items.length,2,'cleaner removes duplicate names, lists and blocklisted words');
ok(!quality.items.some(x=>x.a.includes('Shared alias')),'ambiguous aliases below 3x popularity are dropped');
ok(quality.rejected.duplicate>0 && quality.rejected.invalid>0 && quality.rejected.blocked>0,'quality report counts rejected rows');
const strongAlias = cleanPool([{id:'Q1',n:'Alpha',s:180,a:['Shared']},{id:'Q2',n:'Beta',s:40,a:['Shared']}],{});
ok(strongAlias.items.find(x=>x.id==='Q1').a.includes('Shared'),'alias is retained when the winner has 3x popularity');
const overridePool = applyOverrides('river',[{id:'Q1',n:'Rhine',s:90,a:[]},{id:'Q2',n:'Wrong',s:40,a:[]}],{river:{add:[{n:'Vistula',a:['Wisla']}],remove:['Q2'],aliasAdd:{Q1:['Rhein']}}});
ok(overridePool.some(x=>x.n==='Vistula'&&x.a.includes('Wisla')),'manual add override');
ok(!overridePool.some(x=>x.id==='Q2')&&overridePool.find(x=>x.id==='Q1').a.includes('Rhein'),'manual remove and aliasAdd overrides');
eq(meaningfulChange(overridePool,overridePool.map(x=>({...x,s:x.s+1}))),false,'small popularity drift does not rewrite a pack');
eq(meaningfulChange(overridePool,[...overridePool,{id:'Q9',n:'New answer',s:1,a:[]}]),true,'added answers trigger a meaningful pack write');

console.log(`${passed} passed, ${failed} failed. ${CATALOG.length} prompts, ${Object.keys(SEED).length} seed lists.`);
process.exit(failed ? 1 : 0);
