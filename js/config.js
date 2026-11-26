// APOGEE configuration. Everything tunable lives here.
export const CONFIG = {
  TITLE: 'APOGEE',
  DOMAIN: 'deepwell.games',

  // Flight shape
  PROMPTS_PER_DIVE: 7,
  DAILY_SECONDS: 20,
  // Every scoring answer climbs CLIMB_BASE flight units plus CLIMB_PER_POINT per point, so even a run of common answers
  // leaves the sky (about 2,500 units over seven answers) and rare answers climb much further. Misses climb nothing.
  // Flight units are shown to the player as real-looking distances (km, million km, AU, light-years) by altitudeLabel().
  // (The old names BASE_SINK_M / POINTS_PER_METER / MAX_DEPTH_VISUAL are kept for the stored-data fields called "depth".)
  BASE_SINK_M: 280,
  POINTS_PER_METER: 9,
  MAX_DEPTH_VISUAL: 6000, // units at which the scene is fully "deep space"; zone edges are in ZONES below

  // Data sources (all relative to the site root)
  MANIFEST_URL: 'data/manifest.json',
  PACK_DIR: 'data/packs',

  // Live Wikidata (used in Endless mode when a prompt has no pre-built pack)
  WIKIDATA_ENDPOINT: 'https://query.wikidata.org/sparql',
  LIVE_TIMEOUT_MS: 20000,

  // Letter variants ("Name a river starting with M") need a pool at least this big
  MIN_POOL_FOR_LETTER: 25,

  // Optional crowd rarity backend (see docs/crowd-backend.md). Leave empty to disable.
  // Example: 'https://deepwell-crowd.YOURNAME.workers.dev'
  CROWD_ENDPOINT: '',
  CROWD_MIN_SAMPLES: 30, // prompt needs this many player answers before crowd data counts
  CROWD_WEIGHT: 0.5, // 0 = Wikidata only, 1 = crowd only (once enough samples exist)
  CROWD_TIMEOUT_MS: 1200,
};

/** Flight units a scoring answer climbs. 0 points (a miss) climbs nothing. */
export const sinkMetres = points => (points > 0 ? Math.round(CONFIG.BASE_SINK_M + points * CONFIG.POINTS_PER_METER) : 0);

/* ------------------------------------------------------------------ flight zones and distances
 * One flight unit is not a real distance. The readout turns units into believable distances using these anchors
 * (log-linear between them): the Moon is passed at 2,000 units, Mars at 2,300, the Sun at 2,600, Jupiter at 2,900,
 * Neptune at 3,500, the first star at 4,200 and the far side of the galaxy at 6,000.
 */
export const ZONES = [
  { key: 'sky', label: 'Sky', end: 300 },
  { key: 'stratosphere', label: 'Stratosphere', end: 900 },
  { key: 'orbit', label: 'Low orbit', end: 1800 },
  { key: 'solar', label: 'Solar system', end: 3600 },
  { key: 'interstellar', label: 'Interstellar space', end: 4800 },
  { key: 'galaxy', label: 'Deep space', end: 6000 },
];
const ANCHORS = [ // [flight units, km]
  [0, 0], [300, 1e2], [900, 4e2], [1500, 3.6e4], [2000, 3.844e5], [2300, 7.8e7], [2600, 1.496e8],
  [2900, 7.8e8], [3200, 1.43e9], [3500, 4.5e9], [4200, 4e13], [5000, 9.5e15], [6000, 9.5e17],
];
/** Distance in km for a number of flight units. */
export function unitsToKm(units) {
  const u = Math.min(7600, Math.max(0, Number(units) || 0)); // about 21 billion light-years: the edge of what is visible
  if (u >= ANCHORS[ANCHORS.length - 1][0]) return ANCHORS[ANCHORS.length - 1][1] * Math.pow(10, (u - 6000) / 300);
  for (let i = 1; i < ANCHORS.length; i++) {
    const [u0, k0] = ANCHORS[i - 1], [u1, k1] = ANCHORS[i];
    if (u <= u1) {
      if (i === 1) return k1 * (u / u1);                       // first leg is linear: 0 to 100 km
      const t = (u - u0) / (u1 - u0);
      return Math.pow(10, Math.log10(k0) + t * (Math.log10(k1) - Math.log10(k0)));
    }
  }
  return 0;
}
const round3 = n => (n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100);
/** "850 km", "384,000 km", "78 million km", "5.2 AU", "4.2 light-years", "12,000 light-years". */
export function altitudeLabel(units) {
  const km = unitsToKm(units), fmt = n => n.toLocaleString('en-US');
  if (km < 1e6) return `${fmt(Math.round(km / (km >= 1000 ? 100 : 1)) * (km >= 1000 ? 100 : 1))} km`;
  if (km < 1.5e8 * 0.7) return `${fmt(round3(km / 1e6))} million km`;
  if (km < 1e12) return `${fmt(round3(km / 1.496e8))} AU`;
  const ly = km / 9.461e12;
  if (ly >= 1e9) return `${fmt(round3(ly / 1e9))} billion light-years`;
  if (ly >= 1e6) return `${fmt(round3(ly / 1e6))} million light-years`;
  return `${fmt(ly >= 100 ? Math.round(ly) : round3(ly))} light-years`;
}
export const zoneOf = units => ZONES.find(z => units < z.end) || ZONES[ZONES.length - 1];
