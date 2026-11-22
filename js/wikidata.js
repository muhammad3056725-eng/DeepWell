// Wikidata query building + parsing. Shared by the browser (live mode) and
// scripts/build-data.mjs (pre-built packs). Contains no DOM or Node-only APIs.

const Q = s => String(s).replace(/"/g, '');

/** Build the SPARQL query for one catalog entry. */
export function buildQuery(entry, overrides = {}) {
  const minSL = overrides.minSL ?? Math.max(Number(entry.floor ?? 2), Number(entry.minSL ?? 1));
  // Search broadly, then enforce a separate hard answer-pool ceiling.
  const limit = Math.max(1, Math.min(Number(overrides.limit ?? entry.limit ?? 5000), 5000));
  const maxSL = Number.isFinite(Number(overrides.maxSL)) && overrides.maxSL !== undefined ? `FILTER(?sl <= ${Math.max(1, Number(overrides.maxSL))})` : '';
  const offset = Math.max(0, Math.floor(Number(overrides.offset) || 0));
  const answerLimit = Math.max(1, Math.min(Number(overrides.target ?? entry.target ?? entry.answerLimit ?? 2000), 2000));
  const rawLetter = overrides.startsWith ?? entry.startsWith ?? null;
  const letter = /^[a-z]$/i.test(String(rawLetter || '')) ? String(rawLetter).toLowerCase() : null;
  if (entry.kind === 'taxon') {
    const candidateFilter = letter
      ? `FILTER(STRSTARTS(LCASE(STR(?filterName)), "${letter}"))`
      : '';
    const answerFilter = letter
      ? `FILTER(STRSTARTS(LCASE(STR(?cn)), "${letter}"))`
      : '';
    return `SELECT ?item (MIN(?cn) AS ?name) ?sl
  (GROUP_CONCAT(DISTINCT ?cn; separator="|") AS ?cns)
  (GROUP_CONCAT(DISTINCT ?latin; separator="|") AS ?alts) WHERE {
  { SELECT DISTINCT ?item ?sl WHERE {
      ?item wdt:P31 wd:Q16521; ${entry.pattern}; wikibase:sitelinks ?sl; wdt:P1843 ?filterName.
      FILTER(?sl >= ${minSL})
      ${maxSL}
      FILTER(LANG(?filterName) = "en")
      ${candidateFilter}
    } ORDER BY DESC(?sl) LIMIT ${limit} OFFSET ${offset} }
  ?item wdt:P1843 ?cn. FILTER(LANG(?cn) = "en")
  ${answerFilter}
  OPTIONAL { ?item wdt:P225 ?latin }
} GROUP BY ?item ?sl ORDER BY DESC(?sl) LIMIT ${answerLimit}`;
  }
  const candidateFilter = letter
    ? `FILTER(STRSTARTS(LCASE(STR(?itemLabel)), "${letter}"))`
    : '';
  return `SELECT ?item ?itemLabel ?sl (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {
  { SELECT ?item ?itemLabel ?sl WHERE {
      ?item ${entry.pattern}; wikibase:sitelinks ?sl.
      FILTER(?sl >= ${minSL})
      ${maxSL}
      FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* wd:Q4167410 }
      FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* wd:Q13406463 }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      ${candidateFilter}
    } ORDER BY DESC(?sl) LIMIT ${limit} OFFSET ${offset} }
  OPTIONAL { ?item ?aliasProperty ?alt. VALUES ?aliasProperty { skos:altLabel wdt:P1448 wdt:P1813 wdt:P1705 } FILTER(LANG(?alt) IN ("en", "de", "fr", "es", "it", "pt", "nl", "tr", "id")) }
} GROUP BY ?item ?itemLabel ?sl ORDER BY DESC(?sl) LIMIT ${answerLimit}`;
}

/** Query that fetches the English label of every Q-id so the catalog can be verified. */
export function buildLabelQuery(qids) {
  return `SELECT ?q ?l WHERE { VALUES ?q { ${qids.map(q => 'wd:' + Q(q)).join(' ')} }
  ?q rdfs:label ?l. FILTER(LANG(?l) = "en") }`;
}

const looksLikeId = s => /^Q\d+$/.test(s);

/** Turn a SPARQL JSON response into compact raw items: {id, n, a, s}. */
export function parseBindings(json, entry) {
  const rows = json?.results?.bindings || [];
  const out = [];
  const seenName = new Set();
  for (const row of rows) {
    const id = (row.item?.value || '').split('/').pop();
    const name = (entry.kind === 'taxon' ? row.name?.value : row.itemLabel?.value) || '';
    const s = Number(row.sl?.value || 0);
    if (!id || !/^Q\\d+$/.test(id) || !name || looksLikeId(name) || name.length > 60 || /^\\d{1,4}$/.test(name.trim()) || /^(list of|category:|template:)/i.test(name.trim()) || /https?:\\/\\//i.test(name) || /[<>]/.test(name)) continue;
    const key = name.toLowerCase();
    if (seenName.has(key)) continue; // same label twice: the first (most linked) wins
    seenName.add(key);
    const aliases = [];
    const pushAlias = v => {
      v = String(v || '').trim();
      if (!v || v.length > 120 || looksLikeId(v) || !/^[A-Za-zÀ-ž0-9][A-Za-zÀ-ž0-9 .,'’&()/-]*$/.test(v)) return;
      if (v.toLowerCase() === key || aliases.some(x => x.toLowerCase() === v.toLowerCase())) return;
      aliases.push(v);
    };
    (row.alts?.value || '').split('|').forEach(pushAlias);
    if (entry.kind === 'taxon') (row.cns?.value || '').split('|').forEach(pushAlias);
    if (entry.startsWith && !name.toLowerCase().startsWith(entry.startsWith.toLowerCase())) continue;
    out.push({ id, n: name, s, a: aliases.slice(0, 24) });
  }
  const answerLimit = Math.max(1, Math.min(Number(entry.target ?? entry.answerLimit) || 2000, 2000));
  return out.slice(0, answerLimit);
}

/** Merge saved and new Wikidata answers while preserving data and respecting each prompt cap. */
export function mergePools(existingItems = [], freshItems = [], entry = {}) {
  const byId = new Map();
  const upsert = item => {
    if (!item?.id || !item?.n) return;
    const name = String(item.n).trim();
    if (!name || (entry.startsWith && !name.toLowerCase().startsWith(entry.startsWith.toLowerCase()))) return;
    const previous = byId.get(item.id);
    const aliases = [];
    const add = value => {
      const alias = String(value || '').trim();
      if (!alias || alias.length > 120 || alias.toLowerCase() === name.toLowerCase()) return;
      if (!aliases.some(x => x.toLowerCase() === alias.toLowerCase())) aliases.push(alias);
    };
    for (const a of previous?.a || []) add(a);
    for (const a of item.a || []) add(a);
    byId.set(item.id, { id:item.id, n:name, s:Math.max(Number(previous?.s)||0,Number(item.s)||0), a:aliases.slice(0,24) });
  };
  for (const item of existingItems) upsert(item);
  for (const item of freshItems) upsert(item);
  const cap = Math.max(1,Math.min(Number(entry.target ?? entry.answerLimit)||2000,2000));
  const names = new Set();
  return [...byId.values()].sort((a,b)=>b.s-a.s||a.n.localeCompare(b.n)).filter(item=>{
    const key=item.n.trim().toLowerCase();
    if(names.has(key)) return false;
    names.add(key); return true;
  }).slice(0,cap);
}

export function queryUrl(endpoint, sparql) {
  return `${endpoint}?format=json&origin=*&query=${encodeURIComponent(sparql)}`;
}

/** Fetch an entry's pool straight from Wikidata. Throws on any failure. */
export async function fetchLive(entry, { endpoint, timeoutMs = 9000, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Live mode trades completeness for speed: a smaller, higher-signal pool.
    const sparql = buildQuery(entry, { limit: Math.min(entry.limit || 5000, 5000), minSL: entry.minSL ?? 1 });
    const res = await fetchImpl(queryUrl(endpoint, sparql), {
      signal: ctrl.signal,
      headers: { Accept: 'application/sparql-results+json' },
    });
    if (!res.ok) throw new Error('Wikidata responded ' + res.status);
    return parseBindings(await res.json(), entry);
  } finally {
    clearTimeout(timer);
  }
}

/** Compact v2 packs; the reader continues to accept legacy v1 files. */
export function toPack(entry, items) {
  const cap = Math.max(1, Math.min(Number(entry.target ?? entry.answerLimit) || 2000, 2000));
  const rows = items.slice(0, cap), aliases = {};
  rows.forEach((item, i) => { if (item.a?.length) aliases[i] = item.a; });
  return { v: 2, id: entry.id, built: new Date().toISOString().slice(0,10),
    ids: rows.map(i => String(i.id)), names: rows.map(i => i.n),
    sitelinks: rows.map(i => Number(i.s)||0), aliases };
}
export function fromPack(pack) {
  if (pack?.v === 2) return (pack.names || []).map((n,i) => ({
    id: String(pack.ids?.[i] ?? ''), n, s: Number(pack.sitelinks?.[i])||0, a: pack.aliases?.[i]||[],
  })).filter(i => i.id && i.n);
  return (pack.items || []).map(([num,n,s,a]) => ({ id:'Q'+num, n, s, a:a||[] }));
}
