// APOGEE question catalog.
//
// Every entry is a prompt ("Name a river") plus a Wikidata pattern that defines
// the answer pool. Answers, aliases and popularity (Wikipedia language-edition
// count) come from Wikidata, either pre-built into data/packs/*.json by
// scripts/build-data.mjs or fetched live in the browser.
//
// SAFETY NET: every Wikidata Q-id used below is registered with the English label
// it is expected to have. The build script verifies each one against Wikidata and
// drops any entry whose ids do not match, so a wrong id can never produce a
// mislabeled question.

export const CATEGORIES = [
  'Geography', 'Space', 'Science', 'Nature', 'Food', 'Music', 'Film & TV', 'Literature',
  'Art', 'History', 'Sports', 'Games', 'Technology', 'People', 'Language', 'Mythology',
  'Body', 'Brands', 'Transport', 'Everyday', 'Home', 'Party & Fun',
];

/** qid -> expected English label fragment (lower-case, matched with "includes"). */
export const ENTITY_LABELS = new Map();
const reg = (q, label) => { ENTITY_LABELS.set(q, label.toLowerCase()); return q; };

const inst = (q, l) => `wdt:P31 wd:${reg(q, l)}`;
const sub = (q, l) => `wdt:P31/wdt:P279* wd:${reg(q, l)}`;
const occ = (q, l) => `wdt:P106 wd:${reg(q, l)}`;
const held = (q, l) => `wdt:P39 wd:${reg(q, l)}`;
const won = (q, l) => `wdt:P166 wd:${reg(q, l)}`;
const country = (q, l) => `wdt:P17 wd:${reg(q, l)}`;
const citizen = (q, l) => `wdt:P27 wd:${reg(q, l)}`;
const continent = (q, l) => `wdt:P30 wd:${reg(q, l)}`;

export const CATALOG = [];
const seen = new Set();
function add(cat, id, prompt, pattern, o = {}) {
  if (seen.has(id)) throw new Error('duplicate catalog id ' + id);
  seen.add(id);
  CATALOG.push({ id, cat, prompt, kind: 'item', pattern, minSL: 2, floor: 2, limit: 5000, answerLimit: 2000, minPool: 20, ...o, target: o.target ?? o.answerLimit ?? 2000 });
}
function addTaxon(cat, id, prompt, parentQ, parentLabel, rankQ, rankLabel, o = {}) {
  if (seen.has(id)) throw new Error('duplicate catalog id ' + id);
  seen.add(id);
  reg(parentQ, parentLabel); reg(rankQ, rankLabel);
  CATALOG.push({
    id, cat, prompt, kind: 'taxon', parent: parentQ, rank: rankQ,
    pattern: `wdt:P171+ wd:${parentQ}; wdt:P105 wd:${rankQ}`,
    minSL: 5, floor: 2, limit: 5000, answerLimit: 2000, minPool: 20, ...o, target: o.target ?? o.answerLimit ?? 2000,
  });
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ------------------------------------------------------------------ places */
const CONTINENTS = [
  ['Q15', 'africa', 'Africa'], ['Q46', 'europe', 'Europe'], ['Q48', 'asia', 'Asia'],
  ['Q18', 'south america', 'South America'], ['Q49', 'north america', 'North America'],
  ['Q55643', 'oceania', 'Oceania'],
];
// [qid, expected label, display name (as used in prompts)]
const COUNTRIES = [
  ['Q30', 'united states', 'the United States'], ['Q16', 'canada', 'Canada'],
  ['Q145', 'united kingdom', 'the United Kingdom'], ['Q408', 'australia', 'Australia'],
  ['Q668', 'india', 'India'], ['Q183', 'germany', 'Germany'], ['Q142', 'france', 'France'],
  ['Q38', 'italy', 'Italy'], ['Q29', 'spain', 'Spain'], ['Q155', 'brazil', 'Brazil'],
  ['Q17', 'japan', 'Japan'], ['Q148', 'china', 'China'], ['Q96', 'mexico', 'Mexico'],
  ['Q159', 'russia', 'Russia'], ['Q843', 'pakistan', 'Pakistan'], ['Q43', 'turkey', 'Turkey'],
  ['Q79', 'egypt', 'Egypt'], ['Q1033', 'nigeria', 'Nigeria'], ['Q258', 'south africa', 'South Africa'],
  ['Q414', 'argentina', 'Argentina'], ['Q55', 'netherlands', 'the Netherlands'],
  ['Q36', 'poland', 'Poland'], ['Q34', 'sweden', 'Sweden'], ['Q252', 'indonesia', 'Indonesia'],
  ['Q794', 'iran', 'Iran'], ['Q851', 'saudi arabia', 'Saudi Arabia'],
  ['Q928', 'philippines', 'the Philippines'], ['Q881', 'vietnam', 'Vietnam'],
  ['Q869', 'thailand', 'Thailand'], ['Q884', 'south korea', 'South Korea'],
  ['Q27', 'ireland', 'Ireland'], ['Q664', 'new zealand', 'New Zealand'], ['Q41', 'greece', 'Greece'],
  ['Q45', 'portugal', 'Portugal'], ['Q212', 'ukraine', 'Ukraine'], ['Q739', 'colombia', 'Colombia'],
  ['Q298', 'chile', 'Chile'], ['Q419', 'peru', 'Peru'], ['Q114', 'kenya', 'Kenya'],
  ['Q1028', 'morocco', 'Morocco'], ['Q902', 'bangladesh', 'Bangladesh'],
  // Asia and the Middle East (every id is checked against Wikidata by the build; a wrong one just skips that prompt)
  ['Q854', 'sri lanka', 'Sri Lanka'], ['Q837', 'nepal', 'Nepal'], ['Q889', 'afghanistan', 'Afghanistan'],
  ['Q796', 'iraq', 'Iraq'], ['Q801', 'israel', 'Israel'], ['Q878', 'united arab emirates', 'the United Arab Emirates'],
  ['Q833', 'malaysia', 'Malaysia'], ['Q334', 'singapore', 'Singapore'], ['Q836', 'myanmar', 'Myanmar'],
  ['Q232', 'kazakhstan', 'Kazakhstan'], ['Q265', 'uzbekistan', 'Uzbekistan'], ['Q865', 'taiwan', 'Taiwan'],
  ['Q810', 'jordan', 'Jordan'], ['Q822', 'lebanon', 'Lebanon'], ['Q858', 'syria', 'Syria'],
  ['Q817', 'kuwait', 'Kuwait'], ['Q846', 'qatar', 'Qatar'], ['Q711', 'mongolia', 'Mongolia'],
  ['Q424', 'cambodia', 'Cambodia'], ['Q917', 'bhutan', 'Bhutan'],
  // Balance: Africa, Latin America and Europe get the same depth, so no region dominates the data.
  ['Q115', 'ethiopia', 'Ethiopia'], ['Q117', 'ghana', 'Ghana'], ['Q262', 'algeria', 'Algeria'],
  ['Q924', 'tanzania', 'Tanzania'], ['Q1036', 'uganda', 'Uganda'], ['Q948', 'tunisia', 'Tunisia'],
  ['Q1041', 'senegal', 'Senegal'], ['Q1009', 'cameroon', 'Cameroon'],
  ['Q717', 'venezuela', 'Venezuela'], ['Q736', 'ecuador', 'Ecuador'], ['Q241', 'cuba', 'Cuba'],
  ['Q750', 'bolivia', 'Bolivia'], ['Q77', 'uruguay', 'Uruguay'],
  ['Q20', 'norway', 'Norway'], ['Q35', 'denmark', 'Denmark'], ['Q33', 'finland', 'Finland'],
  ['Q40', 'austria', 'Austria'], ['Q31', 'belgium', 'Belgium'], ['Q213', 'czech', 'Czech Republic'],
  ['Q28', 'hungary', 'Hungary'], ['Q218', 'romania', 'Romania'], ['Q403', 'serbia', 'Serbia'],
  ['Q712', 'fiji', 'Fiji'],
];
const byName = n => COUNTRIES.find(c => c[2].replace(/^the /, '') === n);

// Geography - whole-world classes
const GEO = [
  ['country', 'Name a country', inst('Q3624078', 'sovereign state'), { minPool: 100 }],
  ['capital', 'Name a capital city', `^wdt:P36 [ ${inst('Q3624078', 'sovereign state')} ]`, { minPool: 100, minSL: 10 }],
  ['city', 'Name a city', sub('Q515', 'city'), { minSL: 25 }],
  ['island', 'Name an island', sub('Q23442', 'island')],
  ['river', 'Name a river', sub('Q4022', 'river')],
  ['mountain', 'Name a mountain', sub('Q8502', 'mountain')],
  ['lake', 'Name a lake', sub('Q23397', 'lake')],
  ['volcano', 'Name a volcano', sub('Q8072', 'volcano')],
  ['desert', 'Name a desert', sub('Q8514', 'desert'), { minPool: 15 }],
  ['sea', 'Name a sea', sub('Q165', 'sea'), { minPool: 15 }],
  ['waterfall', 'Name a waterfall', sub('Q34038', 'waterfall')],
  ['national-park', 'Name a national park', sub('Q46169', 'national park')],
  ['mountain-range', 'Name a mountain range', sub('Q46831', 'mountain range')],
  ['peninsula', 'Name a peninsula', sub('Q34763', 'peninsula')],
  ['strait', 'Name a strait', sub('Q37901', 'strait'), { minPool: 15 }],
  ['bay', 'Name a bay', sub('Q39594', 'bay')],
  ['glacier', 'Name a glacier', sub('Q35666', 'glacier')],
  ['canyon', 'Name a canyon', sub('Q150784', 'canyon'), { minPool: 15 }],
  ['archipelago', 'Name an archipelago', sub('Q33837', 'archipelago')],
  ['us-state', 'Name a US state', inst('Q35657', 'u.s. state'), { minPool: 40 }],
  ['indian-state', 'Name a state of India', inst('Q12443800', 'state of india'), { minPool: 20 }],
  ['world-heritage', 'Name a World Heritage Site', `wdt:P1435 wd:${reg('Q9259', 'world heritage')}`],
  ['museum', 'Name a museum', sub('Q33506', 'museum')],
  ['airport', 'Name an airport', sub('Q1248784', 'airport')],
  ['stadium', 'Name a stadium', sub('Q483110', 'stadium')],
  ['bridge', 'Name a bridge', sub('Q12280', 'bridge')],
  ['castle', 'Name a castle', sub('Q23413', 'castle')],
  ['skyscraper', 'Name a skyscraper', sub('Q11303', 'skyscraper')],
  ['cathedral', 'Name a cathedral', sub('Q2977', 'cathedral')],
  ['mosque', 'Name a mosque', sub('Q32815', 'mosque')],
  ['lighthouse', 'Name a lighthouse', sub('Q39715', 'lighthouse')],
  ['dam', 'Name a dam', sub('Q12323', 'dam')],
  ['tower', 'Name a tower', sub('Q12518', 'tower')],
  ['university', 'Name a university', sub('Q3918', 'university'), { minSL: 8 }],
  ['zoo', 'Name a zoo', sub('Q43501', 'zoo')],
  ['amusement-park', 'Name an amusement park', sub('Q194195', 'amusement park')],
  ['railway-station', 'Name a railway station', sub('Q55488', 'railway station'), { minSL: 8 }],
  ['historical-country', 'Name a country that no longer exists', inst('Q3024240', 'historical country')],
];
for (const [id, prompt, pattern, o] of GEO) add('Geography', id, prompt, pattern, o);

for (const [q, label, name] of CONTINENTS) {
  add('Geography', `country-${slug(label)}`, `Name a country in ${name}`,
    `${inst('Q3624078', 'sovereign state')}; ${continent(q, label)}`, { minPool: 8 });
}

// (Country-by-class prompts such as "Name a city in Peru" were removed: questions stay broad.)

/* ------------------------------------------------------------------- space */
const SPACE = [
  ['moon', 'Name a moon', inst('Q2537', 'natural satellite'), { minPool: 30 }],
  ['constellation', 'Name a constellation', inst('Q8928', 'constellation'), { minPool: 40 }],
  ['star', 'Name a star', inst('Q523', 'star'), { minSL: 10 }],
  ['galaxy', 'Name a galaxy', inst('Q318', 'galaxy'), { minSL: 6 }],
  ['asteroid', 'Name an asteroid', inst('Q3863', 'asteroid'), { minSL: 8 }],
  ['comet', 'Name a comet', inst('Q3559', 'comet'), { minSL: 4 }],
  ['dwarf-planet', 'Name a dwarf planet', inst('Q2199', 'dwarf planet'), { minPool: 5 }],
  ['space-probe', 'Name a space probe', inst('Q26529', 'space probe'), { minSL: 4 }],
  ['spacecraft', 'Name a spacecraft', inst('Q40218', 'spacecraft'), { minSL: 4 }],
  ['space-telescope', 'Name a space telescope', inst('Q148578', 'space telescope'), { minPool: 15 }],
  ['exoplanet', 'Name an exoplanet', inst('Q44559', 'exoplanet'), { minSL: 3 }],
  ['nebula', 'Name a nebula', inst('Q42372', 'nebula'), { minSL: 4 }],
  ['astronaut', 'Name an astronaut', occ('Q11631', 'astronaut'), { minSL: 10, people: true }],
  ['observatory', 'Name an astronomical observatory', inst('Q62832', 'observatory'), { minSL: 4 }],
];
for (const [id, prompt, pattern, o] of SPACE) add('Space', id, prompt, pattern, o);

/* ----------------------------------------------------------------- science */
const SCIENCE = [
  ['chemical-element', 'Name a chemical element', inst('Q11344', 'chemical element'), { minPool: 100, answerLimit: 118 }],
  ['mineral', 'Name a mineral', inst('Q12089225', 'mineral species'), { minSL: 4 }],
  ['rock', 'Name a type of rock', sub('Q8063', 'rock'), { minPool: 15 }],
  ['chemical-compound', 'Name a chemical compound', inst('Q11173', 'chemical compound'), { minSL: 20 }],
  ['elementary-particle', 'Name an elementary particle', inst('Q43116', 'elementary particle'), { minPool: 10 }],
  ['unit', 'Name a unit of measurement', inst('Q47574', 'unit of measurement'), { minSL: 6 }],
  ['discipline', 'Name an academic discipline', inst('Q11862829', 'academic discipline'), { minSL: 8 }],
  ['enzyme', 'Name an enzyme', inst('Q8047', 'enzyme'), { minSL: 4 }],
  ['vitamin', 'Name a vitamin', inst('Q34956', 'vitamin'), { minPool: 10 }],
  ['theory', 'Name a scientific theory', inst('Q17737', 'theory'), { minSL: 6, minPool: 15 }],
  ['scientific-instrument', 'Name a scientific instrument', inst('Q2041172', 'measuring instrument'), { minSL: 5, minPool: 15 }],
  ['unit-of-time', 'Name a unit of time', inst('Q1790144', 'unit of time'), { minPool: 8 }],
];
for (const [id, prompt, pattern, o] of SCIENCE) add('Science', id, prompt, pattern, o);

/* ------------------------------------------------------------------ nature */
addTaxon('Nature', 'mammal', 'Name a mammal', 'Q7377', 'mammal', 'Q7432', 'species');
addTaxon('Nature', 'bird', 'Name a bird', 'Q5113', 'bird', 'Q7432', 'species');
// In Wikidata's taxonomy birds descend from Reptilia, so the reptile pool must explicitly exclude Aves (Q5113):
// without this, "Name a reptile starting with H" accepted Hartlaub's bustard.
addTaxon('Nature', 'reptile', 'Name a reptile', 'Q10811', 'reptile', 'Q7432', 'species', { notParent: 'Q5113' });
addTaxon('Nature', 'amphibian', 'Name an amphibian', 'Q10908', 'amphibian', 'Q7432', 'species', { minSL: 3 });
addTaxon('Nature', 'insect', 'Name an insect', 'Q1390', 'insect', 'Q7432', 'species', { minSL: 4 });
addTaxon('Nature', 'flowering-plant', 'Name a flowering plant', 'Q886167', 'flowering plant', 'Q7432', 'species', { minSL: 8 });
// Birds are dinosaurs in Wikidata's taxonomy; players mean the extinct ones, so Aves (Q5113) is excluded.
addTaxon('Nature', 'dinosaur', 'Name a dinosaur', 'Q430', 'dinosaur', 'Q34740', 'genus', { minSL: 3, notParent: 'Q5113', exclude: ['bird'] });
addTaxon('Nature', 'shark', 'Name a shark', 'Q7372', 'shark', 'Q7432', 'species', { minSL: 3, minPool: 15 });
const NATURE = [
  ['dog-breed', 'Name a dog breed', inst('Q39367', 'dog breed'), { minSL: 3 }],
  ['cat-breed', 'Name a cat breed', inst('Q43577', 'cat breed'), { minSL: 3, minPool: 15 }],
];
for (const [id, prompt, pattern, o] of NATURE) add('Nature', id, prompt, pattern, o);

/* -------------------------------------------------------------------- food */
const FOOD = [
  ['food', 'Name a food', sub('Q2095', 'food'), { minSL: 1, limit: 5000 }],
  ['dish', 'Name a dish', inst('Q746549', 'dish'), { minSL: 8 }],
  ['cheese', 'Name a cheese', inst('Q10943', 'cheese'), { minSL: 3 }],
  ['cocktail', 'Name a cocktail', inst('Q134768', 'cocktail'), { minSL: 3, minPool: 15 }],
  ['bread', 'Name a type of bread', sub('Q7802', 'bread'), { minSL: 3 }],
  ['pasta', 'Name a type of pasta', sub('Q178', 'pasta'), { minSL: 3, minPool: 15 }],
  ['sauce', 'Name a sauce', inst('Q178359', 'sauce'), { minSL: 3, minPool: 15 }],
  ['cuisine', 'Name a national cuisine', inst('Q1778821', 'cuisine'), { minSL: 5, minPool: 20 }],
  ['fruit', 'Name a fruit', sub('Q3314483', 'fruit'), { minSL: 8 }],
  ['vegetable', 'Name a vegetable', sub('Q11004', 'vegetable'), { minSL: 8 }],
  ['spice', 'Name a spice', inst('Q42527', 'spice'), { minSL: 4, minPool: 15 }],
  ['dessert', 'Name a dessert', sub('Q182940', 'dessert'), { minSL: 5 }],
  ['beer-style', 'Name a style of beer', inst('Q1998962', 'beer style'), { minSL: 3, minPool: 15 }],
  ['soft-drink', 'Name a soft drink', inst('Q147538', 'soft drink'), { minSL: 5, minPool: 15 }],
];
for (const [id, prompt, pattern, o] of FOOD) add('Food', id, prompt, pattern, o);

/* ------------------------------------------------------------------- music */
const MUSIC = [
  ['instrument', 'Name a musical instrument', sub('Q34379', 'musical instrument'), { minSL: 6 }],
  ['music-genre', 'Name a music genre', inst('Q188451', 'music genre'), { minSL: 8 }],
  ['band', 'Name a band', inst('Q215380', 'musical group'), { minSL: 25 }],
  ['rock-band', 'Name a rock band', inst('Q5741069', 'rock band'), { minSL: 15 }],
  ['album', 'Name an album', inst('Q482994', 'album'), { minSL: 20 }],
  ['song', 'Name a song', inst('Q7366', 'song'), { minSL: 25 }],
  ['opera', 'Name an opera', inst('Q1344', 'opera'), { minSL: 8 }],
  ['symphony', 'Name a symphony', inst('Q9734', 'symphony'), { minSL: 4, minPool: 15 }],
  ['record-label', 'Name a record label', inst('Q18127', 'record label'), { minSL: 8 }],
  ['music-festival', 'Name a music festival', inst('Q868557', 'music festival'), { minSL: 4, minPool: 15 }],
  ['singer', 'Name a singer', occ('Q177220', 'singer'), { minSL: 35, people: true, limit: 1500 }],
  ['rapper', 'Name a rapper', occ('Q2252262', 'rapper'), { minSL: 20, people: true }],
  ['composer', 'Name a composer', occ('Q36834', 'composer'), { minSL: 30, people: true, limit: 1500 }],
  ['guitarist', 'Name a guitarist', occ('Q855091', 'guitarist'), { minSL: 20, people: true }],
  ['pianist', 'Name a pianist', occ('Q486748', 'pianist'), { minSL: 20, people: true }],
  ['conductor', 'Name a conductor', occ('Q158852', 'conductor'), { minSL: 15, people: true }],
];
for (const [id, prompt, pattern, o] of MUSIC) add('Music', id, prompt, pattern, o);

/* ---------------------------------------------------------------- film & tv */
const FILM = [
  ['film', 'Name a film', inst('Q11424', 'film'), { minSL: 35, limit: 1500 }],
  ['animated-film', 'Name an animated film', inst('Q202866', 'animated film'), { minSL: 15 }],
  ['documentary', 'Name a documentary film', inst('Q93204', 'documentary film'), { minSL: 12 }],
  ['tv-series', 'Name a TV series', inst('Q5398426', 'television series'), { minSL: 25, limit: 1500 }],
  ['anime', 'Name an anime series', inst('Q63952888', 'anime'), { minSL: 8 }],
  ['film-genre', 'Name a film genre', inst('Q201658', 'film genre'), { minSL: 5, minPool: 15 }],
  ['film-director', 'Name a film director', occ('Q2526255', 'film director'), { minSL: 35, people: true, limit: 1500 }],
  ['actor', 'Name an actor', occ('Q33999', 'actor'), { minSL: 45, people: true, limit: 1500 }],
  ['comedian', 'Name a comedian', occ('Q245068', 'comedian'), { minSL: 20, people: true }],
  ['film-studio', 'Name a film studio', inst('Q1762059', 'film production company'), { minSL: 8 }],
  ['tv-network', 'Name a television network', inst('Q1254874', 'television network'), { minSL: 6 }],
  ['superhero', 'Name a superhero', inst('Q188784', 'superhero'), { minSL: 6 }],
];
for (const [id, prompt, pattern, o] of FILM) add('Film & TV', id, prompt, pattern, o);

/* -------------------------------------------------------------- literature */
const LIT = [
  ['novel', 'Name a novel', inst('Q8261', 'novel'), { minSL: 25, limit: 1500 }],
  ['play', 'Name a play', inst('Q25379', 'play'), { minSL: 12 }],
  ['poem', 'Name a poem', inst('Q5185279', 'poem'), { minSL: 10 }],
  ['book-series', 'Name a book series', inst('Q277759', 'book series'), { minSL: 8 }],
  ['literary-genre', 'Name a literary genre', inst('Q223393', 'literary genre'), { minSL: 5, minPool: 15 }],
  ['comic-series', 'Name a comic book series', inst('Q14406742', 'comic book series'), { minSL: 5 }],
  ['manga', 'Name a manga series', inst('Q21198342', 'manga series'), { minSL: 6 }],
  ['newspaper', 'Name a newspaper', inst('Q11032', 'newspaper'), { minSL: 8 }],
  ['magazine', 'Name a magazine', inst('Q41298', 'magazine'), { minSL: 8 }],
  ['fictional-character', 'Name a fictional character', inst('Q95074', 'character'), { minSL: 20, limit: 1500 }],
  ['writer', 'Name a writer', occ('Q36180', 'writer'), { minSL: 45, people: true, limit: 1500 }],
  ['novelist', 'Name a novelist', occ('Q6625963', 'novelist'), { minSL: 30, people: true, limit: 1500 }],
  ['poet', 'Name a poet', occ('Q49757', 'poet'), { minSL: 30, people: true, limit: 1500 }],
  ['playwright', 'Name a playwright', occ('Q214917', 'playwright'), { minSL: 20, people: true }],
];
for (const [id, prompt, pattern, o] of LIT) add('Literature', id, prompt, pattern, o);

/* --------------------------------------------------------------------- art */
const ART = [
  ['painting', 'Name a painting', inst('Q3305213', 'painting'), { minSL: 12, limit: 1500 }],
  ['sculpture', 'Name a sculpture', inst('Q860861', 'sculpture'), { minSL: 8 }],
  ['art-movement', 'Name an art movement', inst('Q968159', 'art movement'), { minSL: 5, minPool: 15 }],
  ['architectural-style', 'Name an architectural style', inst('Q32880', 'architectural style'), { minSL: 5, minPool: 15 }],
  ['art-museum', 'Name an art museum', inst('Q207694', 'art museum'), { minSL: 8 }],
  ['painter', 'Name a painter', occ('Q1028181', 'painter'), { minSL: 35, people: true, limit: 1500 }],
  ['sculptor', 'Name a sculptor', occ('Q1281618', 'sculptor'), { minSL: 20, people: true }],
  ['photographer', 'Name a photographer', occ('Q33231', 'photographer'), { minSL: 20, people: true }],
  ['architect', 'Name an architect', occ('Q42973', 'architect'), { minSL: 25, people: true }],
  ['fashion-designer', 'Name a fashion designer', occ('Q3501317', 'fashion designer'), { minSL: 15, people: true }],
];
for (const [id, prompt, pattern, o] of ART) add('Art', id, prompt, pattern, o);

/* ----------------------------------------------------------------- history */
const HIST = [
  ['war', 'Name a war', inst('Q198', 'war'), { minSL: 6 }],
  ['battle', 'Name a battle', inst('Q178561', 'battle'), { minSL: 10, limit: 1500 }],
  ['empire', 'Name an empire', inst('Q48349', 'empire'), { minSL: 5, minPool: 15 }],
  ['dynasty', 'Name a dynasty', inst('Q164950', 'dynasty'), { minSL: 4 }],
  ['revolution', 'Name a revolution', inst('Q10931', 'revolution'), { minSL: 4, minPool: 15 }],
  ['treaty', 'Name a treaty', inst('Q131569', 'treaty'), { minSL: 6 }],
  ['archaeological-site', 'Name an archaeological site', inst('Q839954', 'archaeological site'), { minSL: 8 }],
  ['ideology', 'Name a political ideology', inst('Q12909644', 'political ideology'), { minSL: 5, minPool: 15 }],
  ['monarch', 'Name a monarch', occ('Q116', 'monarch'), { minSL: 35, people: true, limit: 1500 }],
  ['us-president', 'Name a US president', held('Q11696', 'president of the united states'), { minPool: 40, minSL: 1, people: true }],
  ['uk-prime-minister', 'Name a British prime minister', held('Q14211', 'prime minister of the united kingdom'), { minPool: 40, minSL: 1, people: true }],
  ['pope', 'Name a pope', held('Q19546', 'pope'), { minPool: 60, minSL: 1, people: true }],
  ['explorer', 'Name an explorer', occ('Q11900058', 'explorer'), { minSL: 20, people: true }],
  ['politician', 'Name a politician', occ('Q82955', 'politician'), { minSL: 60, people: true, limit: 1500 }],
  ['philosopher', 'Name a philosopher', occ('Q4964182', 'philosopher'), { minSL: 35, people: true, limit: 1500 }],
  ['inventor', 'Name an inventor', occ('Q205375', 'inventor'), { minSL: 20, people: true }],
  ['holiday', 'Name a holiday', inst('Q1445650', 'holiday'), { minSL: 6 }],
  ['festival', 'Name a festival', inst('Q132241', 'festival'), { minSL: 5 }],
];
for (const [id, prompt, pattern, o] of HIST) add('History', id, prompt, pattern, o);

/* ------------------------------------------------------------------ sports */
const SPORTS = [
  ['sport', 'Name a sport', inst('Q349', 'sport'), { minSL: 4 }],
  ['football-club-world', 'Name a football club', inst('Q476028', 'association football club'), { minSL: 20 }],
  ['national-football-team', 'Name a national football team', inst('Q6979593', 'national association football team'), { minSL: 8, minPool: 40 }],
  ['footballer', 'Name a footballer', occ('Q937857', 'association football player'), { minSL: 45, people: true, limit: 1500 }],
  ['tennis-player', 'Name a tennis player', occ('Q10833314', 'tennis player'), { minSL: 25, people: true }],
  ['cricketer', 'Name a cricketer', occ('Q12299841', 'cricketer'), { minSL: 8, people: true, limit: 1500 }],
  ['basketball-player', 'Name a basketball player', occ('Q3665646', 'basketball player'), { minSL: 20, people: true }],
  ['f1-driver', 'Name a Formula One driver', occ('Q10841764', 'formula one driver'), { minSL: 10, people: true }],
  ['chess-player', 'Name a chess player', occ('Q10873124', 'chess player'), { minSL: 12, people: true }],
  ['boxer', 'Name a boxer', occ('Q11338576', 'boxer'), { minSL: 12, people: true }],
  ['golfer', 'Name a golfer', occ('Q11303721', 'golfer'), { minSL: 10, people: true }],
];
for (const [id, prompt, pattern, o] of SPORTS) add('Sports', id, prompt, pattern, o);

// (Nationality splits such as "Name a poet from Nepal" were removed: questions stay broad.)

/* --------------------------------------------------------- people (global) */
const PEOPLE = [
  ['physicist', 'Name a physicist', occ('Q169470', 'physicist'), { minSL: 35 }],
  ['chemist', 'Name a chemist', occ('Q593644', 'chemist'), { minSL: 25 }],
  ['mathematician', 'Name a mathematician', occ('Q170790', 'mathematician'), { minSL: 35 }],
  ['biologist', 'Name a biologist', occ('Q864503', 'biologist'), { minSL: 25 }],
  ['astronomer', 'Name an astronomer', occ('Q11063', 'astronomer'), { minSL: 25 }],
  ['computer-scientist', 'Name a computer scientist', occ('Q82594', 'computer scientist'), { minSL: 15 }],
  ['economist', 'Name an economist', occ('Q188094', 'economist'), { minSL: 25 }],
  ['psychologist', 'Name a psychologist', occ('Q212980', 'psychologist'), { minSL: 20 }],
  ['engineer', 'Name an engineer', occ('Q81096', 'engineer'), { minSL: 25 }],
  ['chef', 'Name a chef', occ('Q3499072', 'chef'), { minSL: 10 }],
  ['nobel-physics', 'Name a Nobel Prize winner in Physics', won('Q38104', 'nobel prize in physics'), { minSL: 1, minPool: 100 }],
  ['nobel-chemistry', 'Name a Nobel Prize winner in Chemistry', won('Q44585', 'nobel prize in chemistry'), { minSL: 1, minPool: 100 }],
  ['nobel-medicine', 'Name a Nobel Prize winner in Medicine', won('Q80061', 'nobel prize in physiology or medicine'), { minSL: 1, minPool: 100 }],
  ['nobel-literature', 'Name a Nobel Prize winner in Literature', won('Q37922', 'nobel prize in literature'), { minSL: 1, minPool: 100 }],
  ['nobel-peace', 'Name a Nobel Peace Prize winner', won('Q35637', 'nobel peace prize'), { minSL: 1, minPool: 80 }],
  ['nobel-economics', 'Name a Nobel laureate in Economics', won('Q47170', 'economic sciences'), { minSL: 1, minPool: 60 }],
];
for (const [id, prompt, pattern, o] of PEOPLE) add('People', id, prompt, pattern, { people: true, limit: 1500, ...o });

/* ---------------------------------------------------------------- language */
const LANG = [
  ['language', 'Name a language', inst('Q34770', 'language'), { minSL: 10 }],
  ['writing-system', 'Name a writing system', inst('Q8192', 'writing system'), { minSL: 5, minPool: 15 }],
  ['currency', 'Name a currency', inst('Q8142', 'currency'), { minSL: 8 }],
  ['religion', 'Name a religion', inst('Q9174', 'religion'), { minSL: 8, minPool: 15 }],
  ['ethnic-group', 'Name an ethnic group', inst('Q41710', 'ethnic group'), { minSL: 10 }],
  ['profession', 'Name a profession', inst('Q28640', 'profession'), { minSL: 10 }],
  ['emotion', 'Name an emotion', inst('Q9415', 'emotion'), { minSL: 6, minPool: 15 }],
  ['dance', 'Name a dance', inst('Q11639', 'dance'), { minSL: 4, minPool: 20 }],
  ['martial-art', 'Name a martial art', inst('Q11417', 'martial art'), { minSL: 3, minPool: 15 }],
  ['logical-fallacy', 'Name a logical fallacy', inst('Q186150', 'fallacy'), { minSL: 3, minPool: 15 }],
];
for (const [id, prompt, pattern, o] of LANG) add('Language', id, prompt, pattern, o);

/* ---------------------------------------------------------------- mythology */
const MYTH = [
  ['deity', 'Name a deity', inst('Q178885', 'deity'), { minSL: 10 }],
  ['legendary-creature', 'Name a legendary creature', inst('Q2239243', 'mythical creature'), { minSL: 6 }],
  ['mythological-character', 'Name a mythological figure', inst('Q4271324', 'mythical character'), { minSL: 10 }],
  ['prophet', 'Name a prophet', occ('Q42857', 'prophet'), { minSL: 8, minPool: 20, people: true }],
  ['saint', 'Name a saint', occ('Q43115', 'saint'), { minSL: 25, minPool: 20, people: true, limit: 1000 }],
  ['religious-text', 'Name a religious text', inst('Q179461', 'religious text'), { minSL: 4, minPool: 20 }],
];
for (const [id, prompt, pattern, o] of MYTH) add('Mythology', id, prompt, pattern, o);

/* -------------------------------------------------------------------- body */
const BODY = [
  ['disease', 'Name a disease', inst('Q12136', 'disease'), { minSL: 20 }],
  ['infectious-disease', 'Name an infectious disease', inst('Q18123741', 'infectious disease'), { minSL: 10 }],
  ['mental-disorder', 'Name a mental disorder', inst('Q12135', 'mental disorder'), { minSL: 8 }],
  ['medication', 'Name a medication', inst('Q12140', 'medication'), { minSL: 20 }],
  ['medical-specialty', 'Name a medical specialty', inst('Q930752', 'medical specialty'), { minSL: 5, minPool: 20 }],
  ['symptom', 'Name a symptom', inst('Q169872', 'symptom'), { minSL: 6, minPool: 15 }],
];
for (const [id, prompt, pattern, o] of BODY) add('Body', id, prompt, pattern, o);

/* ------------------------------------------------------------------- games */
const GAMES = [
  ['video-game', 'Name a video game', inst('Q7889', 'video game'), { minSL: 30, limit: 1500 }],
  ['video-game-console', 'Name a video game console', inst('Q8076', 'video game console'), { minSL: 6, minPool: 20 }],
  ['video-game-genre', 'Name a video game genre', inst('Q659563', 'video game genre'), { minSL: 4, minPool: 15 }],
  ['board-game', 'Name a board game', inst('Q131436', 'board game'), { minSL: 5 }],
  ['card-game', 'Name a card game', inst('Q142714', 'card game'), { minSL: 4 }],
  ['video-game-developer', 'Name a video game developer', inst('Q210167', 'video game developer'), { minSL: 8 }],
  ['pokemon', 'Name a Pokémon', inst('Q3966183', 'pokémon species'), { minSL: 12, minPool: 100 }],
  ['toy', 'Name a toy', inst('Q11422', 'toy'), { minSL: 4, minPool: 20 }],
];
for (const [id, prompt, pattern, o] of GAMES) add('Games', id, prompt, pattern, o);

/* -------------------------------------------------------------- technology */
const TECH = [
  ['programming-language', 'Name a programming language', sub('Q9143', 'programming language'), { minSL: 2, limit: 5000 }],
  ['operating-system', 'Name an operating system', inst('Q9135', 'operating system'), { minSL: 5 }],
  ['file-format', 'Name a file format', inst('Q235557', 'file format'), { minSL: 8 }],
  ['website', 'Name a website', inst('Q35127', 'website'), { minSL: 20 }],
  ['mobile-app', 'Name a mobile app', inst('Q620615', 'mobile app'), { minSL: 10 }],
  ['web-browser', 'Name a web browser', inst('Q6368', 'web browser'), { minSL: 5, minPool: 20 }],
  ['programming-paradigm', 'Name a programming paradigm', inst('Q188267', 'programming paradigm'), { minSL: 3, minPool: 12 }],
  ['software-company', 'Name a software company', inst('Q1058914', 'software company'), { minSL: 10 }],
  ['search-engine', 'Name a search engine', inst('Q4182287', 'search engine'), { minSL: 4, minPool: 15 }],
  ['invention', 'Name an invention', inst('Q12579633', 'invention'), { minSL: 10, minPool: 20 }],
];
for (const [id, prompt, pattern, o] of TECH) add('Technology', id, prompt, pattern, o);

/* ------------------------------------------------------------------ brands */
const BRANDS = [
  ['brand', 'Name a brand', inst('Q431289', 'brand'), { minSL: 20, limit: 1500 }],
  ['company', 'Name a company', inst('Q4830453', 'business'), { minSL: 40, limit: 1500 }],
  ['bank', 'Name a bank', inst('Q22687', 'bank'), { minSL: 10 }],
  ['car-manufacturer', 'Name a car manufacturer', inst('Q786820', 'automobile manufacturer'), { minSL: 8 }],
  ['car-model', 'Name a car model', inst('Q3231690', 'car model'), { minSL: 15, limit: 1500 }],
  ['restaurant-chain', 'Name a restaurant chain', inst('Q18534542', 'restaurant chain'), { minSL: 6, minPool: 20 }],
  ['supermarket-chain', 'Name a supermarket chain', inst('Q18043413', 'supermarket chain'), { minSL: 4, minPool: 20 }],
];
for (const [id, prompt, pattern, o] of BRANDS) add('Brands', id, prompt, pattern, o);

/* --------------------------------------------------------------- transport */
const TRANSPORT = [
  ['airline', 'Name an airline', inst('Q46970', 'airline'), { minSL: 8 }],
  ['aircraft-model', 'Name an aircraft model', inst('Q15056993', 'aircraft family'), { minSL: 6, minPool: 20 }],
  ['ship-type', 'Name a type of ship', sub('Q11446', 'ship'), { minSL: 6, minPool: 20, limit: 800 }],
  ['motorcycle-manufacturer', 'Name a motorcycle manufacturer', inst('Q15081030', 'motorcycle manufacturer'), { minSL: 4, minPool: 15 }],
];
for (const [id, prompt, pattern, o] of TRANSPORT) add('Transport', id, prompt, pattern, o);


/* ------------------------------------------------------------ broad additions */
// More broad, everyday-knowledge prompts. Each id is verified against Wikidata by the build (a wrong id only skips it).
const MORE = [
  ['Geography', 'palace', 'Name a palace', sub('Q16560', 'palace'), { minSL: 6 }],
  ['Geography', 'temple', 'Name a temple', sub('Q44539', 'temple'), { minSL: 6 }],
  ['Geography', 'church', 'Name a church', sub('Q16970', 'church building'), { minSL: 12 }],
  ['Geography', 'beach', 'Name a beach', sub('Q40080', 'beach'), { minSL: 4 }],
  ['Geography', 'cave', 'Name a cave', sub('Q35509', 'cave'), { minSL: 4 }],
  ['Geography', 'forest', 'Name a forest', sub('Q4421', 'forest'), { minSL: 4 }],
  ['Geography', 'canal', 'Name a canal', sub('Q12284', 'canal'), { minSL: 4 }],
  ['Geography', 'town-square', 'Name a famous square or plaza', sub('Q174782', 'square'), { minSL: 6 }],
  ['People', 'scientist', 'Name a scientist', occ('Q901', 'scientist'), { minSL: 25, people: true }],
  ['Music', 'musician', 'Name a musician', occ('Q639669', 'musician'), { minSL: 25, people: true }],
  ['Music', 'singer-songwriter', 'Name a singer-songwriter', occ('Q488205', 'singer-songwriter'), { minSL: 15, people: true }],
  ['People', 'businessperson', 'Name a businessperson', occ('Q43845', 'businessperson'), { minSL: 20, people: true }],
  ['People', 'journalist', 'Name a journalist', occ('Q1930187', 'journalist'), { minSL: 25, people: true }],
  ['People', 'model', 'Name a fashion model', occ('Q4610556', 'model'), { minSL: 15, people: true }],
  ['People', 'youtuber', 'Name a YouTuber', occ('Q17125263', 'youtuber'), { minSL: 6, people: true }],
  ['People', 'dancer', 'Name a dancer', occ('Q5716684', 'dancer'), { minSL: 15, people: true }],
  ['Film & TV', 'tv-presenter', 'Name a TV presenter', occ('Q947873', 'television presenter'), { minSL: 15, people: true }],
  ['Film & TV', 'screenwriter', 'Name a screenwriter', occ('Q28389', 'screenwriter'), { minSL: 25, people: true }],
  ['Film & TV', 'film-producer', 'Name a film producer', occ('Q3282637', 'film producer'), { minSL: 25, people: true }],
  ['Film & TV', 'sitcom', 'Name a sitcom', inst('Q170238', 'sitcom'), { minSL: 6 }],
  ['Film & TV', 'musical', 'Name a musical', inst('Q2743', 'musical'), { minSL: 5 }],
  ['Film & TV', 'animated-character', 'Name a cartoon character', inst('Q15711870', 'animated character'), { minSL: 6 }],
  ['Games', 'video-game-character', 'Name a video game character', inst('Q1569167', 'video game character'), { minSL: 6 }],
  ['Sports', 'swimmer', 'Name a swimmer', occ('Q10843402', 'swimmer'), { minSL: 15, people: true }],
  ['Sports', 'cyclist', 'Name a cyclist', occ('Q2309784', 'cyclist'), { minSL: 15, people: true }],
  ['Sports', 'baseball-player', 'Name a baseball player', occ('Q10871364', 'baseball player'), { minSL: 10, people: true }],
  ['Sports', 'american-football-player', 'Name an American football player', occ('Q19204627', 'american football player'), { minSL: 8, people: true }],
  ['Sports', 'ice-hockey-player', 'Name an ice hockey player', occ('Q11774891', 'ice hockey player'), { minSL: 12, people: true }],
  ['Sports', 'racing-driver', 'Name a racing driver', occ('Q378622', 'racing'), { minSL: 12, people: true }],
  ['Sports', 'athlete', 'Name a track and field athlete', occ('Q11513337', 'athletics competitor'), { minSL: 20, people: true }],
  ['Technology', 'social-network', 'Name a social network', inst('Q3220391', 'social networking service'), { minSL: 6, minPool: 15 }],
  ['Technology', 'smartphone', 'Name a smartphone model', inst('Q19723451', 'smartphone model'), { minSL: 6, minPool: 15 }],
];
for (const [cat, id, prompt, pattern, o] of MORE) add(cat, id, prompt, pattern, o);
addTaxon('Nature', 'fish', 'Name a fish', 'Q127282', 'actinopterygii', 'Q7432', 'species', { minSL: 5 });
addTaxon('Nature', 'spider', 'Name a spider', 'Q1357', 'spider', 'Q7432', 'species', { minSL: 3, minPool: 15 });

/* ------------------------------------------------------------ list growth */
// Bigger answer lists: the old limit was 2,000 answers per question and a high popularity floor (minSL) that cut off
// everything but the best known. Lists now grow to GROW_TARGET answers and reach down to GROW_FLOOR Wikipedia language
// editions, so players are credited for obscure-but-real answers. The same limits apply to every country and region.
// Closed sets (planets, chemical elements) keep their natural size: an explicit answerLimit below the default is respected.
const GROW_TARGET = {
  People: 6000, Geography: 6000, 'Film & TV': 6000, Music: 6000, Literature: 5000, Sports: 6000, Nature: 6000,
  Art: 5000, History: 5000, Games: 5000, Food: 4000, Brands: 4000, Transport: 4000, Technology: 4000, Science: 4000,
  Space: 4000, Language: 4000, Mythology: 4000, Body: 3000,
};
const GROW_FLOOR = 8;
for (const e of CATALOG) {
  if (e.answerLimit < 2000) continue;
  e.target = Math.max(e.target || 0, GROW_TARGET[e.cat] || 4000);
  e.answerLimit = e.target;
  e.minSL = Math.min(e.minSL ?? GROW_FLOOR, GROW_FLOOR);
}

/* ------------------------------------------------------------------ helpers */
export const BASE_CATALOG_COUNT = CATALOG.length;
export const CATALOG_BY_ID = new Map(CATALOG.map(e => [e.id, e]));

/** Curated survey-style prompts ("Name something people do at a party") live in data/curated/ and reach the
 * catalog through the manifest (kind: 'curated'); they have no Wikidata pattern. */
export function registerCurated(list) {
  for (const p of list) {
    if (!p?.id || CATALOG_BY_ID.has(p.id)) continue;
    const entry = { id: p.id, cat: p.cat || 'Everyday', prompt: p.prompt, kind: 'curated', level: p.level || 2, minPool: 8, target: p.n };
    CATALOG.push(entry); CATALOG_BY_ID.set(p.id, entry);
  }
}

export function entityIdsOf(entry) {
  return [...new Set(String(entry.pattern || '').match(/wd:Q\d+/g) || [])].map(s => s.slice(3));
}
