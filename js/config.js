// DEEPWELL configuration. Everything tunable lives here.
export const CONFIG = {
  TITLE: 'DEEPWELL',
  DOMAIN: 'deepwell.games',

  // Dive shape
  PROMPTS_PER_DIVE: 7,
  DAILY_SECONDS: 20,
  // Every scoring answer sinks BASE_SINK_M metres, plus POINTS_PER_METER per point, so even a run of common answers
  // reaches the deep (about 2,300 m over seven answers) and rare answers drop much further. Misses sink nothing.
  BASE_SINK_M: 250,
  POINTS_PER_METER: 8,
  MAX_DEPTH_VISUAL: 4000, // metres at which the scene is fully "deep" (zone edges 400 / 1,500 / 3,500 m match the depth gauge)

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

/** Metres a scoring answer sinks. 0 points (a miss) sinks nothing. */
export const sinkMetres = points => (points > 0 ? Math.round(CONFIG.BASE_SINK_M + points * CONFIG.POINTS_PER_METER) : 0);
