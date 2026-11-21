// Wikidata query building + parsing. Shared by the browser (live mode) and
// scripts/build-data.mjs (pre-built packs). Contains no DOM or Node-only APIs.

const Q = s => String(s).replace(/"/g, '');

/** Build the SPARQL query for one catalog entry. */
export function buildQuery(entry, overrides = {}) {
  const minSL = overrides.minSL ?? entry.minSL ?? 3;
  const limit = overrides.limit ?? entry.limit ?? 1200;
  if (entry.kind === 'taxon') {
    return `SELECT ?item (MIN(?cn) AS ?name) ?sl
  (GROUP_CONCAT(DISTINCT ?cn; separator="|") AS ?cns)
  (GROUP_CONCAT(DISTINCT ?latin; separator="|") AS ?alts) WHERE {
  { SELECT ?item ?sl WHERE {
      ?item wdt:P31 wd:Q16521; ${entry.pattern}; wikibase:sitelinks ?sl.
      FILTER(?sl >= ${minSL})
    } ORDER BY DESC(?sl) LIMIT ${limit} }
  ?item wdt:P1843 ?cn. FILTER(LANG(?cn) = "en")
  OPTIONAL { ?item wdt:P225 ?latin }
} GROUP BY ?item ?sl ORDER BY DESC(?sl)`;
  }
  return `SELECT ?item ?itemLabel ?sl (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {
  { SELECT ?item ?sl WHERE {
      ?item ${entry.pattern}; wikibase:sitelinks ?sl.
      FILTER(?sl >= ${minSL})
    } ORDER BY DESC(?sl) LIMIT ${limit} }
  OPTIONAL { ?item skos:altLabel ?alt. FILTER(LANG(?alt) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} GROUP BY ?item ?itemLabel ?sl ORDER BY DESC(?sl)`;
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
    if (!id || !name || looksLikeId(name) || name.length > 70) continue;
    const key = name.toLowerCase();
    if (seenName.has(key)) continue; // same label twice: the first (most linked) wins
    seenName.add(key);
    const aliases = [];
    const pushAlias = v => {
      v = String(v || '').trim();
      if (!v || v.length > 70 || looksLikeId(v)) return;
      if (v.toLowerCase() === key || aliases.some(x => x.toLowerCase() === v.toLowerCase())) return;
      aliases.push(v);
    };
    (row.alts?.value || '').split('|').forEach(pushAlias);
    if (entry.kind === 'taxon') (row.cns?.value || '').split('|').forEach(pushAlias);
    out.push({ id, n: name, s, a: aliases.slice(0, 8) });
  }
  return out;
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
    const sparql = buildQuery(entry, { limit: Math.min(entry.limit || 1200, 600) });
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

/** Compact on-disk pack format used by data/packs/*.json */
export function toPack(entry, items) {
  return {
    v: 1,
    id: entry.id,
    built: new Date().toISOString().slice(0, 10),
    items: items.map(i => [Number(i.id.slice(1)), i.n, i.s, i.a]),
  };
}
export function fromPack(pack) {
  return (pack.items || []).map(([num, n, s, a]) => ({ id: 'Q' + num, n, s, a: a || [] }));
}
