// Offline self-test: node scripts/selftest.mjs
// Checks the catalog, query builder, matching, rarity and seeded picking. No network needed.
import { CATALOG, ENTITY_LABELS, entityIdsOf } from '../js/catalog.js';
import { readAnyPrompt } from './linked-store.mjs';
import { buildQuery, parseBindings, toPack, fromPack, mergePools, ANSWER_CAP } from '../js/wikidata.js';
import {
  normalize, matchAnswer, buildPool, assignRarity, pickEntries, planDive, DIVE_PLAN, mulberry32, hashString,
  letterOptions, deriveLetterPool, blendPoints, tier, previousUtcDate,
} from '../js/engine.js';
import { SEED } from '../js/seed.js';
import { parseSeed } from '../js/data.js';
import { cleanPool, applyOverrides, meaningfulChange, rankAliases, ensureAnchors, checkAnchors } from './data-quality.mjs';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { readCurated } from './linked-store.mjs';

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
ok(CATALOG.length >= 250, 'catalog keeps at least 250 broad Wikidata prompts');
ok(!CATALOG.some(e => e.startsWith || /-(?:from|in)-[a-z]/.test(e.id)), 'no narrow "starting with X" or "from <country>" prompts');
eq(new Set(CATALOG.map(e => e.prompt)).size, CATALOG.length, 'all prompt texts are unique');
ok(CATALOG.every(e => (e.target ?? e.answerLimit ?? 2000) <= ANSWER_CAP), 'no prompt allows more than the answer cap');
const foodF = { ...CATALOG.find(e => e.id === 'food'), id: 'food-starts-f', startsWith: 'F', target: 5000, answerLimit: 5000 };
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
ok(new RegExp('LIMIT '+programmingEntry.target+'$').test(buildQuery(programmingEntry)), 'programming-language answer pool follows its target');
ok(buildQuery(foodF, { limit: 5000, minSL: 1 }).includes('STRSTARTS(LCASE(STR(?itemLabel)), "f")'), 'food F query filters labels by F');
const foodFQuery = buildQuery(foodF, { limit: 5000, minSL: 1 });
ok(foodFQuery.indexOf('STRSTARTS') < foodFQuery.indexOf('LIMIT 5000'), 'food F prefix is applied before candidate truncation');
const insectA = { ...taxon, startsWith: 'A' };
const insectAQuery = buildQuery(insectA, { limit: 5000, minSL: 1 });
ok(insectAQuery.includes('STRSTARTS(LCASE(STR(?filterName)), "a")'), 'taxon letter filtering is applied to common names before candidate limit');
ok(insectAQuery.indexOf('STRSTARTS') < insectAQuery.indexOf('LIMIT 5000'), 'taxon prefix is applied before candidate truncation');
ok(/LIMIT 5000$/.test(buildQuery(foodF, { limit: 5000, minSL: 1 })), 'food F query returns no more than its 5,000 target');
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
eq(matchAnswer('Vistla', pool)?.item.n, 'Vistula', 'a one-letter typo finds the answer');
eq(matchAnswer('xyz', pool), null, 'nonsense does not match');
ok(!matchAnswer('Rhin', pool)?.auto, 'short fuzzy inputs are only suggested, never counted automatically');
const people = buildPool([{ id: 'Q1', n: 'Albert Einstein', s: 90, a: [] }, { id: 'Q2', n: 'Isaac Newton', s: 80, a: [] }], { people: true });
eq(matchAnswer('Einstein', people)?.item.n, 'Albert Einstein', 'unique surname matches a person');

// ---- partial names, plurals, spacing and spelling (the player rarely types the full official name)
{
  const pms = buildPool([
    { id: 'Q8016', n: 'Winston Churchill', s: 230, a: [] }, { id: 'Q7416', n: 'Margaret Thatcher', s: 160, a: ['Maggie Thatcher'] },
    { id: 'Q9545', n: 'Tony Blair', s: 140, a: [] }, { id: 'Q1', n: 'William Pitt the Younger', s: 60, a: [] },
    { id: 'Q2', n: 'William Pitt the Elder', s: 50, a: [] }, { id: 'Q3', n: 'Winston Peters', s: 20, a: [] },
  ]);
  const m1 = matchAnswer('winston', pms);
  ok(m1?.item.n === 'Winston Churchill' && m1.auto, 'a first name alone finds the best-known answer ("winston")');
  ok(matchAnswer('churchil', pms)?.item.n === 'Winston Churchill', 'surname typo finds the answer');
  ok(matchAnswer('margret thatcher', pms)?.item.n === 'Margaret Thatcher', 'misspelled full name finds the answer');
  ok(matchAnswer('pitt', pms)?.near, 'an ambiguous surname asks the player to confirm');
  const things = buildPool([{ id: 'a', n: 'Empire State Building', s: 120, a: [] }, { id: 'b', n: 'Petronas Towers', s: 90, a: [] },
    { id: 'c', n: 'Spider-Man', s: 100, a: [] }, { id: 'd', n: 'Strawberry', s: 80, a: [] }, { id: 'e', n: 'Lake Victoria', s: 80, a: [] },
    { id: 'f', n: 'Lake Superior', s: 70, a: [] }, { id: 'g', n: 'Pyotr Ilyich Tchaikovsky', s: 150, a: [] }]);
  eq(matchAnswer('empire state', things)?.item.n, 'Empire State Building', 'leading words of a long name');
  eq(matchAnswer('petronas', things)?.item.n, 'Petronas Towers', 'one distinctive word');
  eq(matchAnswer('spiderman', things)?.item.n, 'Spider-Man', 'spaces and hyphens do not matter');
  eq(matchAnswer('strawberries', things)?.item.n, 'Strawberry', 'plurals count');
  eq(matchAnswer('victoria', things)?.item.n, 'Lake Victoria', 'the distinctive part of a place name');
  ok(!matchAnswer('lake', things)?.auto, 'a generic word ("lake") never counts on its own');
  eq(matchAnswer('chaikovsky', things)?.item.n, 'Pyotr Ilyich Tchaikovsky', 'sound-alike spelling of a surname');
  // ...but never a different word that merely sounds or looks close
  const actors = buildPool([{ id: 'p', n: 'Joe Pesci', s: 90, a: [] }, { id: 'q', n: 'Poesia Bernesca', s: 5, a: [] }]);
  eq(matchAnswer('pizza', actors), null, '"pizza" is not Joe Pesci');
  const tools = buildPool([{ id: 'g', n: 'Glue', s: 50, a: [] }, { id: 'h', n: 'Hammer', s: 90, a: [] }]);
  eq(matchAnswer('blue', tools), null, '"blue" is not glue (short words need the same first letter)');
  const shop = buildPool([{ id: 'c:pet-food', n: 'Pet food', s: 40, a: ['dog food', 'cat food'] }, { id: 'c:milk', n: 'Milk', s: 99, a: [] }], { curated: true });
  ok(!matchAnswer('dog', shop)?.auto, 'everyday lists: "dog" never counts as "dog food" automatically');
}

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
eq(quality.items.length,3,'cleaner removes duplicate names, lists and blocklisted words');
ok(!quality.items.some(x=>x.a.includes('Shared alias')),'ambiguous aliases below 3x popularity are dropped');
ok(quality.rejected.duplicate>0 && quality.rejected.invalid>0 && quality.rejected.blocked>0,'quality report counts rejected rows');
const strongAlias = cleanPool([{id:'Q1',n:'Alpha',s:180,a:['Shared']},{id:'Q2',n:'Beta',s:40,a:['Shared']}],{});
ok(strongAlias.items.find(x=>x.id==='Q1').a.includes('Shared'),'alias is retained when the winner has 3x popularity');
const overridePool = applyOverrides('river',[{id:'Q1',n:'Rhine',s:90,a:[]},{id:'Q2',n:'Wrong',s:40,a:[]}],{river:{add:[{n:'Vistula',a:['Wisla']}],remove:['Q2'],aliasAdd:{Q1:['Rhein']}}});
ok(overridePool.some(x=>x.n==='Vistula'&&x.a.includes('Wisla')),'manual add override');
ok(!overridePool.some(x=>x.id==='Q2')&&overridePool.find(x=>x.id==='Q1').a.includes('Rhein'),'manual remove and aliasAdd overrides');
eq(meaningfulChange(overridePool,overridePool.map(x=>({...x,s:x.s+1}))),false,'small popularity drift does not rewrite a pack');
eq(meaningfulChange(overridePool,[...overridePool,{id:'Q9',n:'New answer',s:1,a:[]}]),true,'added answers trigger a meaningful pack write');

// ---- famous answers must never be rejected (regression for China / Paris / Tokyo / Madagascar / Kilimanjaro)
{
  const chinaPool = buildPool([{id:'Q148',n:"People's Republic of China",s:400,a:['cn','Red China']},{id:'Q30',n:'United States',s:430,a:[]}]);
  ok(!matchAnswer('China', chinaPool)?.exact, 'sanity: before alias ranking "China" is not an alias');
  const cleaned = cleanPool([{id:'Q148',n:"People's Republic of China",s:401,a:['cn','Red China','Communist China','China PR','P.R.C.','PR China','The PRC','a1','a2','a3','a4','a5']}], {cat:'Geography'});
  const cn = buildPool(cleaned.items);
  ok(matchAnswer('China', cn)?.exact, 'country: China is accepted even when the official name has many aliases');
  ok(rankAliases("People's Republic of China", ['zzz long odd alias here', 'China'])[0] === 'China', 'short label variant outranks other aliases');
  // fuzzy hardening: a short foreign alias must not capture a different famous answer
  const pool = buildPool([{id:'Q90',n:'Paris',s:300,a:[]},{id:'Q1',n:'Poti',s:50,a:['Pasis']}]);
  eq(matchAnswer('Paris', pool)?.item.n, 'Paris', 'Paris is an exact hit and never "Did you mean Poti"');
  const pool2 = buildPool([{id:'Q1',n:'Poti',s:50,a:['Pasis']}]);
  ok(!matchAnswer('Paris', pool2), 'short alias is ignored for fuzzy matching');
  // anchors are enforced through the real matcher
  const miss = checkAnchors([{id:'a',n:'Alpha',s:9,a:[]}], {anchors:['Alpha','Beta']});
  eq(JSON.stringify(miss.missing), '["Beta"]', 'checkAnchors reports answers the game would reject');
  const forced = ensureAnchors(Array.from({length:10},(_, i)=>({id:'x'+i,n:'Item '+i,s:50-i,a:[]})), {anchors:['Famous One']}, 't');
  ok(checkAnchors(forced.items, {anchors:['Famous One']}).missing.length === 0 && forced.injected.length === 1, 'ensureAnchors adds and reports a missing anchor');
  const dup = applyOverrides('t',[{id:'Q1',n:'Paris',s:300,a:[]}],{t:{add:[{n:'paris',a:['City of Light']}]}});
  eq(dup.length, 1, 'override add never duplicates an existing answer');
  ok(dup[0].a.includes('City of Light'), 'override add merges aliases into the existing answer');
  eq(normalize('C++'), 'c++', 'C++ stays distinct from C');
}
// Real packs (when present): the answers every player would type first must be accepted.
{
  const MUST = [['country','China'],['country','United States'],['capital','Paris'],['capital','London'],['capital','Tokyo'],['city','Tokyo'],['city','Paris'],
    ['island','Madagascar'],['mountain','Kilimanjaro'],['volcano','Mount Etna'],['volcano','Mount Fuji'],['river','Nile'],['university','Harvard University'],['tower','Eiffel Tower']];
  const MAN = existsSync('data/manifest.json') ? JSON.parse(readFileSync('data/manifest.json', 'utf8')) : { packs: {} };
  const reptileItems = MAN.packs.reptile ? await readAnyPrompt(MAN, 'reptile') : null;
  if (reptileItems) {   // birds must not count as reptiles
    const rp = buildPool(reptileItems);
    ok(!matchAnswer('Bald Eagle', rp)?.exact && !matchAnswer("Hartlaub's bustard", rp)?.exact, 'real pack reptile does not accept birds');
    ok(matchAnswer('Komodo dragon', rp)?.exact, 'real pack reptile accepts Komodo dragon');
  }
  for (const [id, answer] of MUST) {
    const items = MAN.packs[id] ? await readAnyPrompt(MAN, id) : null;
    if (!items) continue;
    const m = matchAnswer(answer, buildPool(items));
    ok(m?.exact, `real pack ${id} accepts "${answer}" (exact match)`);
    if (m?.exact) ok(m.item.r <= 25, `real pack ${id}: "${answer}" is a famous answer, so few points (${m.item.r})`);
  }
}

// ---- fair dives: difficulty curve, one letter question at most, deterministic
{
  const cats = ['A','B','C','D','E','F','G','H'];
  const entries = Array.from({ length: 160 }, (_, i) => ({ id: 'e' + i, cat: cats[i % 8], prompt: 'Name ' + i, ...(i % 5 === 0 ? { startsWith: 'a' } : {}) }));
  const meta = { prompts: Object.fromEntries(entries.map((e, i) => [e.id, { level: 1 + (i % 3) }])) };
  let letterTotal = 0, rampOk = true, dupOk = true;
  for (let seed = 1; seed <= 200; seed++) {
    const picks = planDive(entries, mulberry32(seed), meta);
    const dive = picks.filter(p => !p.spare && !p.fallback), spares = picks.filter(p => p.spare);
    const ids = picks.map(p => p.entry.id);
    if (new Set(ids).size !== ids.length) dupOk = false;
    if (dive.length !== 7 || spares.length !== 2) rampOk = false;
    DIVE_PLAN.forEach((lv, i) => { if (dive[i] && dive[i].level !== lv) rampOk = false; });
    letterTotal += dive.filter(p => p.entry.startsWith).length + dive.filter(p => p.allowLetter).length > 1 ? 1000 : 0;
    if (dive[0].entry.startsWith || dive[1].entry.startsWith || dive[2].entry.startsWith) letterTotal += 1000;
  }
  ok(rampOk, 'planDive: 7 prompts + 2 spares following the easy-to-hard plan when data allows');
  ok(dupOk, 'planDive: no prompt repeated within a dive or its spares');
  eq(letterTotal, 0, 'planDive: at most one "starting with" question per dive and never as an opener');
  eq(planDive(entries, mulberry32(9), meta).map(p => p.entry.id).join(), planDive(entries, mulberry32(9), meta).map(p => p.entry.id).join(), 'planDive is deterministic for a seed');
  const thin = planDive(entries.slice(0, 9), mulberry32(3), {}, { count: 7, spares: 2 });
  ok(thin.length >= 7, 'planDive still fills a dive when metadata is missing');
}

// ---- v4 linked store: every answer stored once; curated prompts and overlays are well formed
{
  const MAN = existsSync('data/manifest.json') ? JSON.parse(readFileSync('data/manifest.json', 'utf8')) : { packs: {} };
  if (MAN.store?.v === 4) {
    const seenIds = new Set(); let dup = 0;
    for (const f of readdirSync('data/linked').filter(f => /^e\.\d+\.json$/.test(f))) {
      for (const id of JSON.parse(readFileSync('data/linked/' + f, 'utf8')).ids) { if (seenIds.has(id)) dup++; seenIds.add(id); }
    }
    eq(dup, 0, 'store: no answer is stored twice');
    eq(seenIds.size, MAN.store.entities, 'store: manifest entity count matches the chunks');
    const curated = await readCurated();
    ok(curated.length >= 80, `at least 80 curated survey prompts/overlays (${curated.length})`);
    for (const p of curated) ok(p.answers.length >= 30, `curated ${p.id} has 30+ answers (${p.answers.length})`);
    const MUST2 = [['mammal', 'cat'], ['mammal', 'whale'], ['mammal', 'bear'], ['fruit', 'pineapple'], ['fruit', 'watermelon'],
      ['party-activities', 'dancing'], ['party-activities', 'karaoke'], ['kitchen', 'fridge'], ['bird', 'penguins'], ['hobby', 'reading']];
    for (const [id, answer] of MUST2) {
      if (!MAN.packs[id]) { ok(false, 'missing prompt ' + id); continue; }
      ok(matchAnswer(answer, buildPool(await readAnyPrompt(MAN, id)))?.exact, `${id} accepts "${answer}"`);
    }
  }
}

console.log(`${passed} passed, ${failed} failed. ${CATALOG.length} prompts, ${Object.keys(SEED).length} seed lists.`);
process.exit(failed ? 1 : 0);
