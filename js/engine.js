// APOGEE engine: matching, rarity scoring, prompt picking. Pure functions, no DOM.

/* ------------------------------------------------------------- normalising */
export function normalize(value) {
  const source = String(value ?? '').trim().toLowerCase();
  // These suffixes are semantic, not decorative punctuation: C, C++ and C#
  // are three different languages. Keep this compact form distinct.
  const compact = source.replace(/\s+/g, '');
  if (/^[a-z](?:\+\+|#)$/.test(compact)) return compact;
  return source
    .replace(/&/g, ' and ')
    .replace(/['’‘`´]/g, '')                       // "Schindler's" -> "schindlers", "s'mores" -> "smores"
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ł/g, 'l').replace(/đ/g, 'd')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Very small English singulariser used on both sides of a match ("berries" -> "berry", "foxes" -> "fox"). */
export function singular(key) {
  return key.split(' ').map(w => {
    if (w.length < 4 || /(ss|us|is|ous)$/.test(w)) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/(ches|shes|xes|zes|sses|oes)$/.test(w)) return w.slice(0, -2);
    if (/s$/.test(w)) return w.slice(0, -1);
    return w;
  }).join(' ');
}

/** A rough "sounds like" key: collapses spellings that are pronounced alike ("Tchaikovsky"/"Chaikovski", "Filipe"/"Philippe"). */
export function soundKey(key) {
  // "ch"/"sh" sounds are protected as 9/8 so the later "c" and "h" rules cannot break them.
  let k = key.replace(/ /g, '')
    .replace(/^ts?ch/, '9').replace(/t?sch/g, '8').replace(/tch/g, '9').replace(/ch/g, '9').replace(/sh/g, '8')
    .replace(/ph/g, 'f').replace(/gh/g, 'g').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks')
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/z/g, 's').replace(/w(?=[aeiou])/g, 'v').replace(/y/g, 'i')
    .replace(/^kn/, 'n').replace(/^wr/, 'r').replace(/th/g, 't').replace(/dt/g, 't').replace(/h/g, '');
  if (!k) return '';
  k = k[0] + k.slice(1).replace(/[aeiou]+/g, 'a');
  return k.replace(/(.)\1+/g, '$1');
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
// Regnal numbers and other numbers tell answers apart (John Paul I / John Paul II, Apollo 11 / Apollo 13).
const ROMAN = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xv|\d+)$/;
// Words that never identify an answer on their own ("Name a lake": typing "lake" must not pick Lake Victoria).
const WEAK = new Set(['of', 'and', 'in', 'on', 'at', 'to', 'for', 'de', 'la', 'le', 'el', 'del', 'da', 'di', 'van', 'von', 'der',
  'saint', 'st', 'san', 'santa', 'mount', 'mt', 'lake', 'river', 'new', 'old', 'great', 'little', 'big', 'north', 'south',
  'east', 'west', 'national', 'park', 'city', 'island', 'islands', 'bay', 'sea', 'ocean', 'cape', 'fort', 'port', 'jr', 'sr',
  'king', 'queen', 'prince', 'princess', 'sir', 'lord', 'lady', 'dr', 'mr', 'mrs', 'film', 'song', 'album', 'band',
  'tower', 'building', 'bridge', 'castle', 'palace', 'church', 'cathedral', 'university', 'station', 'airport', 'stadium',
  'museum', 'temple', 'mosque', 'club', 'fc', 'team', 'game', 'series', 'show', 'common', 'american', 'european', 'african',
  'asian', 'red', 'blue', 'green', 'black', 'white', 'golden', 'grey', 'gray', 'brown', 'yellow']);

/**
 * raw: [{id, n, a:[], s}] -> pool {items, exact:Map, keys:[[key,item]], tokens:Map, sounds:Map, size, raw}
 * Every answer is reachable by its name, its aliases, their singular and space-free forms. Each distinctive word
 * of a name (≥3 letters) is indexed too, so "winston" finds Winston Churchill and "petronas" the Petronas Towers.
 * opts.people is accepted for compatibility (surnames are now indexed for every pool).
 */
export function buildPool(raw, opts = {}) {
  const items = raw.map(r => ({ id: r.id, n: r.n, a: r.a || [], s: r.s || 0, r: 0, p: 0, keys: [] }));
  assignRarity(items);
  const exact = new Map(), labelKeys = new Set(), tokens = new Map(), sounds = new Map(), wordSounds = new Map();
  const claim = (key, item) => {
    if (!key) return;
    if (!exact.has(key)) exact.set(key, item); // items are sorted by fame: the better known one keeps the key
    if (!item.keys.includes(key)) item.keys.push(key);
  };
  const variants = k => [k, singular(k), k.replace(/ /g, '')];
  for (const it of items) { const k = normalize(it.n); if (k) labelKeys.add(k); for (const v of variants(k)) claim(v, it); }
  for (const it of items) for (const al of it.a) for (const v of variants(normalize(al))) claim(v, it);
  for (const it of items) {
    for (const key of it.keys) {
      const words = key.split(' ');
      if (words.length > 1) for (const w of words) {
        if ((w.length < 3 && !ROMAN.test(w)) || WEAK.has(w)) continue;
        const list = tokens.get(w) || tokens.set(w, []).get(w);
        if (!list.includes(it)) list.push(it);
        if (w.length >= 5) {
          const ws = soundKey(w), sl = wordSounds.get(ws) || wordSounds.set(ws, []).get(ws);
          if (!sl.includes(it)) sl.push(it);
        }
      }
      const sk = key.length >= 6 ? soundKey(key) : '';
      if (sk && !sounds.has(sk)) sounds.set(sk, { item: it, key });
    }
  }
  const keys = [...exact.entries()];
  // curated: everyday words ("dog food") rather than names, so one shared word only suggests an answer
  return { items, exact, keys, labelKeys, tokens, sounds, wordSounds, size: items.length, raw, curated: Boolean(opts.curated) };
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
/** The best known of several candidates, and whether it clearly dominates the runner-up. */
function pickFamous(cands) {
  const sorted = [...new Set(cands)].sort((x, y) => y.s - x.s);
  const [top, next] = sorted;
  return { top, clear: !next || top.s >= Math.max(2, next.s * 1.8), n: sorted.length };
}

/** Items whose name/alias contains every word of `words` as whole words (in any order). */
function wordMatches(pool, words) {
  if (!words.length) return [];
  let set = null;
  for (const w of words) {
    const list = pool.tokens.get(w) || [];
    set = set ? set.filter(x => list.includes(x)) : list.slice();
    if (!set.length) return [];
  }
  return set;
}

/**
 * Find what the player meant. Returns null or { item, how, exact|auto|near, key }:
 *   exact  - the name or an alias (also plural/singular and with or without spaces): counts at once
 *   auto   - a confident partial or nearest match ("winston" -> Winston Churchill, "tchaikovski"): counts at once,
 *            and the game shows what it was counted as
 *   near   - a plausible guess the player confirms ("Did you mean ...?")
 */
export function matchAnswer(input, pool) {
  const value = normalize(input);
  if (!value) return null;
  for (const v of [value, singular(value), value.replace(/ /g, '')]) {
    const hit = pool.exact.get(v);
    if (hit) return { item: hit, exact: true, how: 'exact', key: v };
  }
  if (value.length < 3) return null;
  const words = singular(value).split(' ').filter(Boolean);
  const strong = words.filter(w => (w.length >= 3 || ROMAN.test(w)) && !WEAK.has(w));

  // 1. Partial names: every distinctive typed word is a whole word of the answer ("winston", "empire state").
  if (pool.tokens && strong.length) {
    let cands = wordMatches(pool, strong);
    // Extra words that many answers share ("pope" in "Pope John Paul II") are dropped if nothing matched with them.
    if (!cands.length && strong.length > 1) {
      const common = w => (pool.tokens.get(w)?.length || 0) > Math.max(3, pool.size * 0.04);
      const rest = strong.filter(w => !common(w) && pool.tokens.has(w));
      if (rest.length && rest.length < strong.length) cands = wordMatches(pool, rest);
    }
    if (strong.every(w => ROMAN.test(w))) cands = [];   // a bare number is never enough
    if (cands.length) {
      const { top, clear, n } = pickFamous(cands);
      const tooGeneric = strong.length === 1 && n > Math.max(12, pool.size * 0.05) && !clear;
      // In everyday lists one shared word is only a suggestion ("dog" is not "dog food"); names count at once.
      const sure = clear && !(pool.curated && strong.length === 1);
      if (!tooGeneric && !(pool.curated && strong.length === 1 && strong[0].length < 4)) {
        return { item: top, how: 'partial', key: value, ...(sure ? { auto: true } : { near: true }) };
      }
    }
  }

  // 2. Nearest spelling of a whole name or alias.
  let best = null;
  if (value.length >= 4) {
    for (const [key, item] of pool.keys) {
      const isLabel = pool.labelKeys ? pool.labelKeys.has(key) : true;
      if (key.length < (isLabel ? 4 : 6)) continue;
      const limit = key.length < 6 ? 1 : key.length < 10 ? 2 : 3;
      if (Math.abs(key.length - value.length) > limit) continue;
      if (key[0] !== value[0] && value.length <= 5) continue;  // short words: "blue" is not "glue"
      let d = distance(value, key, limit);
      if (d > limit) continue;
      if (key[0] !== value[0]) d += 0.5;                       // a different first letter is a weaker hint
      if (!best || d < best.d || (d === best.d && item.s > best.item.s)) best = { item, d, key };
    }
  }
  // 3. Nearest spelling of one distinctive word ("winstin" -> Winston Churchill).
  if (!best && pool.tokens && strong.length === 1 && value.length >= 5) {
    let tb = null;
    for (const [tok, list] of pool.tokens) {
      if (tok.length < 5 || Math.abs(tok.length - value.length) > 1 || tok[0] !== value[0]) continue;
      if (distance(value, tok, 1) > 1) continue;
      const { top, clear } = pickFamous(list);
      if (clear && (!tb || top.s > tb.item.s)) tb = { item: top, d: 1.5, key: tok };
    }
    if (tb) best = tb;
  }
  // 4. Sounds the same ("chaikovsky" vs "Tchaikovsky"). Only for longer words with a similar length, so short
  //    everyday words never drift ("pizza" is not "Pesci").
  if (!best && value.length >= 6 && pool.sounds) {
    const sk = soundKey(value), hit = pool.sounds.get(sk);
    const close = k => Math.abs(k.length - value.length) <= 2 && soundKey(k[0]) === soundKey(value[0]);
    if (hit && close(hit.key)) best = { item: hit.item, d: 1.5, key: hit.key };
    else if (strong.length === 1 && pool.wordSounds) {
      const list = pool.wordSounds.get(sk);
      if (list?.length) { const { top, clear } = pickFamous(list); if (clear) best = { item: top, d: 1.5, key: value }; }
    }
  }
  if (!best) return null;
  const confident = best.d <= 1 && value.length >= 6;
  return { item: best.item, how: 'typo', key: best.key, ...(confident ? { auto: true } : { near: true }) };
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

/**
 * Build a dive with a fair difficulty curve. `meta.prompts[id].level` is 3 easy / 2 medium / 1 hard (see
 * scripts/build-prompt-meta.mjs); prompts without metadata count as medium. Slots follow DIVE_PLAN (easy start, one hard
 * "boss" at the end), categories are spread, and "starting with <letter>" questions appear at most once per dive and never
 * as an opener. The first `count` picks are the dive, the next `spares` are swap replacements (levels in SPARE_PLAN),
 * and `extra` further picks are fallbacks in case a pack fails to load. Deterministic for a given `rnd`.
 */
export const DIVE_PLAN = [3, 3, 3, 2, 2, 2, 1];
export const SPARE_PLAN = [3, 2];
export function planDive(entries, rnd, meta, { count = 7, spares = 2, extra = 30, category = null } = {}) {
  const pool = entries.filter(e => !category || e.cat === category);
  const levelOf = e => meta?.prompts?.[e.id]?.level ?? e.level ?? 2;
  // Every other slot prefers a broad everyday "survey" prompt (party, kitchen, hobbies...) when one is left.
  const everyday = e => e.kind === 'curated';
  const used = new Set(), usedCats = new Set(), picks = [];
  const deriveSlot = rnd() < 0.5 ? 4 : -1;              // one slot may turn into a "starting with" variant
  let catalogLetters = 0;
  const slotLevels = [...Array.from({ length: count }, (_, i) => DIVE_PLAN[i] ?? 2), ...Array.from({ length: spares }, (_, i) => SPARE_PLAN[i] ?? 2)];
  const choose = (level, slot) => {
    const order = [level, ...(level === 3 ? [2, 1] : level === 2 ? [3, 1] : [2, 3])];
    for (const strict of [true, false]) for (const lv of order) {
      const options = pool.filter(e => !used.has(e.id) && levelOf(e) === lv && (!strict || !usedCats.has(e.cat)) &&
        (!e.startsWith || (slot >= 3 && lv >= 2 && deriveSlot < 0 && catalogLetters < 1)));
      const preferred = slot % 2 === 0 ? options.filter(everyday) : options.filter(e => !everyday(e));
      const list = preferred.length ? preferred : options;
      if (list.length) return list[Math.floor(rnd() * list.length)];
    }
    return null;
  };
  slotLevels.forEach((level, slot) => {
    const e = choose(level, slot); if (!e) return;
    used.add(e.id); usedCats.add(e.cat); if (e.startsWith) catalogLetters++;
    picks.push({ entry: e, level: levelOf(e), variantRoll: rnd(), letterRoll: rnd(), allowLetter: slot === deriveSlot, spare: slot >= count });
  });
  // fallbacks: everything else, categories spread, no letter spam
  const rest = shuffle(pool.filter(e => !used.has(e.id) && !e.startsWith), rnd).slice(0, extra);
  for (const e of rest) picks.push({ entry: e, level: levelOf(e), variantRoll: 1, letterRoll: rnd(), allowLetter: false, spare: false, fallback: true });
  return picks;
}

/** Decide the letter variant for a pick once its pool is known. Deterministic. */
export function chooseVariant(pick, pool, { minPool = 14, chance = 0.3 } = {}) {
  const letters = letterOptions(pool, minPool);
  if (pick.allowLetter !== false && pick.variantRoll < chance && letters.length >= 3 && pool.size >= minPool * 3) {
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
