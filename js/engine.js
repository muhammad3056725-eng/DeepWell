// DEEPWELL engine: matching, rarity scoring, prompt picking. Pure functions, no DOM.

/* ------------------------------------------------------------- normalising */
export function normalize(value) {
  const source = String(value ?? '').trim().toLowerCase();
  // These suffixes are semantic, not decorative punctuation: C, C++ and C#
  // are three different languages. Keep this compact form distinct.
  const compact = source.replace(/\s+/g, '');
  if (/^[a-z](?:\+\+|#)$/.test(compact)) return compact;
  return source
    .replace(/&/g, ' and ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ł/g, 'l').replace(/đ/g, 'd')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Damerau-Levenshtein distance that gives up (returns max+1) once it must exceed `max`. */
export function distance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

/* ----------------------------------------------------------------- rarity */
export const TIERS = ['Common', 'Familiar', 'Uncommon', 'Rare', 'Very Rare', 'Singular'];
export function tier(points) {
  return points <= 20 ? 'Common' : points <= 40 ? 'Familiar' : points <= 60 ? 'Uncommon'
    : points <= 80 ? 'Rare' : points <= 94 ? 'Very Rare' : 'Singular';
}
export const tierClass = t => 'tier-' + t.toLowerCase().replace(/\s+/g, '-');

/**
 * Rarity points (3..100) from popularity (higher `s` = better known).
 * An answer's percentile is the share of the pool that is better known than it,
 * using mid-ranks so ties get the same score. Best known ~3, rarest 100.
 */
export function assignRarity(items) {
  const n = items.length;
  items.sort((x, y) => y.s - x.s);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && items[j + 1].s === items[i].s) j++;
    const p = n > 1 ? (i + (j - i) / 2) / (n - 1) : 0.5;
    const r = Math.max(3, Math.min(100, Math.round(3 + 97 * Math.pow(p, 1.1))));
    for (let k = i; k <= j; k++) { items[k].p = p; items[k].r = r; }
    i = j + 1;
  }
  return items;
}

/* ------------------------------------------------------------------- pools */
/**
 * raw: [{id, n, a:[], s}] -> pool {items, exact:Map, keys:[[key,item]], size, raw}
 * opts.people: also accept a unique surname ("Einstein") as an alias.
 */
export function buildPool(raw, opts = {}) {
  const items = raw.map(r => ({ id: r.id, n: r.n, a: r.a || [], s: r.s || 0, r: 0, p: 0, keys: [] }));
  assignRarity(items);
  const exact = new Map();
  const claim = (key, item) => {
    if (!key) return;
    if (!exact.has(key)) exact.set(key, item); // items are sorted by fame: the better known one keeps the key
    if (!item.keys.includes(key)) item.keys.push(key);
  };
  for (const it of items) { claim(normalize(it.n), it); }
  for (const it of items) { for (const al of it.a) claim(normalize(al), it); }
  if (opts.people) {
    const tally = new Map();
    for (const it of items) {
      const toks = normalize(it.n).split(' ');
      if (toks.length > 1) { const last = toks[toks.length - 1]; tally.set(last, (tally.get(last) || 0) + 1); }
    }
    for (const it of items) {
      const toks = normalize(it.n).split(' ');
      const last = toks[toks.length - 1];
      if (toks.length > 1 && last.length >= 4 && tally.get(last) === 1 && !exact.has(last)) claim(last, it);
    }
  }
  const keys = [...exact.entries()];
  return { items, exact, keys, size: items.length, raw };
}

export const firstLetter = name => (normalize(name)[0] || '').toUpperCase();

/** Letters that have at least `min` answers in the pool, e.g. ['A','B',...]. */
export function letterOptions(pool, min = 14) {
  const count = new Map();
  for (const it of pool.items) {
    const L = firstLetter(it.n);
    if (/[A-Z]/.test(L)) count.set(L, (count.get(L) || 0) + 1);
  }
  return [...count.entries()].filter(([, c]) => c >= min).map(([L]) => L).sort();
}

/** A sub-pool of answers starting with `letter`; rarity is recomputed inside it. */
export function deriveLetterPool(pool, letter, opts = {}) {
  const raw = pool.raw.filter(r => firstLetter(r.n) === letter);
  return buildPool(raw, opts);
}

/* ---------------------------------------------------------------- matching */
/**
 * -> { item, exact:true } | { item, near:true } | null
 * Fuzzy matches only apply to inputs of 5+ characters and must share a first letter.
 */
export function matchAnswer(input, pool) {
  const value = normalize(input);
  if (!value) return null;
  const hit = pool.exact.get(value);
  if (hit) return { item: hit, exact: true, key: value };
  if (value.length < 5) return null;
  let best = null;
  for (const [key, item] of pool.keys) {
    if (key[0] !== value[0]) continue;
    const limit = key.length < 8 ? 1 : key.length < 13 ? 2 : 3;
    if (Math.abs(key.length - value.length) > limit) continue;
    const d = distance(value, key, limit);
    if (d <= limit && (!best || d < best.d || (d === best.d && item.s > best.item.s))) best = { item, d, key };
  }
  return best ? { item: best.item, near: true, key: best.key } : null;
}

/* -------------------------------------------------------------- crowd blend */
/**
 * Combine the Wikidata rarity with real player data when enough exists.
 * crowd = {count, total} for this answer on this prompt.
 */
export function blendPoints(basePoints, crowd, { minSamples = 30, weight = 0.5 } = {}) {
  if (!crowd || !(crowd.total >= minSamples)) return { points: basePoints, crowdUsed: false };
  const share = Math.max(0, Math.min(1, (crowd.count || 0) / crowd.total));
  const crowdPts = Math.max(3, Math.min(100, Math.round(3 + 97 * (1 - Math.sqrt(share)))));
  return { points: Math.round((1 - weight) * basePoints + weight * crowdPts), crowdUsed: true, share };
}

/* ------------------------------------------------------- seeded randomness */
export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Pick `count` prompts, spreading them across categories (one per category before
 * any repeats) so People/Geography, which have the most entries, cannot dominate.
 * Each pick also carries two pre-drawn rolls used to decide a letter variant, so a
 * seeded run is fully deterministic.
 */
export function pickEntries(entries, count, rnd, { avoid = new Set(), category = null } = {}) {
  let pool = entries.filter(e => !category || e.cat === category);
  const fresh = pool.filter(e => !avoid.has(e.id));
  if (fresh.length >= count) pool = fresh;
  const groups = new Map();
  for (const e of pool) { if (!groups.has(e.cat)) groups.set(e.cat, []); groups.get(e.cat).push(e); }
  const cats = shuffle([...groups.keys()].sort(), rnd);
  const taken = new Set();
  const picks = [];
  let ci = 0, emptyInARow = 0;
  while (picks.length < count && cats.length && emptyInARow < cats.length) {
    const cat = cats[ci++ % cats.length];
    const options = groups.get(cat).filter(e => !taken.has(e.id));
    if (!options.length) { emptyInARow++; continue; }
    emptyInARow = 0;
    const e = options[Math.floor(rnd() * options.length)];
    taken.add(e.id);
    picks.push({ entry: e, variantRoll: rnd(), letterRoll: rnd() });
  }
  return picks;
}

/** Decide the letter variant for a pick once its pool is known. Deterministic. */
export function chooseVariant(pick, pool, { minPool = 14, chance = 0.3 } = {}) {
  const letters = letterOptions(pool, minPool);
  if (pick.variantRoll < chance && letters.length >= 3 && pool.size >= minPool * 3) {
    return letters[Math.floor(pick.letterRoll * letters.length)];
  }
  return null;
}

export const promptKey = (entry, letter) => (letter ? `${entry.id}:${letter}` : entry.id);
export const promptText = (entry, letter) => (letter ? `${entry.prompt} starting with ${letter}` : entry.prompt);

/** UTC calendar date as YYYY-MM-DD (the Daily Dive resets for everyone at 00:00 UTC). */
export function utcDate(d = new Date()) { return d.toISOString().slice(0, 10); }
export function previousUtcDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDate(d);
}
