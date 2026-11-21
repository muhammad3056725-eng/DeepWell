// DEEPWELL configuration. Everything tunable lives here.
export const CONFIG = {
  TITLE: 'DEEPWELL',
  DOMAIN: 'deepwell.games',

  // Dive shape
  PROMPTS_PER_DIVE: 7,
  DAILY_SECONDS: 20,
  POINTS_PER_METER: 10,
  MAX_DEPTH_VISUAL: 4000, // metres at which the scene is fully "deep"

  // Data sources (all relative to the site root)
  MANIFEST_URL: 'data/manifest.json',
  PACK_DIR: 'data/packs',

  // Live Wikidata (used in Endless mode when a prompt has no pre-built pack)
  WIKIDATA_ENDPOINT: 'https://query.wikidata.org/sparql',
  LIVE_TIMEOUT_MS: 20000,

  // Letter variants ("Name a river starting with M") need a pool at least this big
  MIN_POOL_FOR_LETTER: 14,

  // Optional crowd rarity backend (see docs/crowd-backend.md). Leave empty to disable.
  // Example: 'https://deepwell-crowd.YOURNAME.workers.dev'
  CROWD_ENDPOINT: '',
  CROWD_MIN_SAMPLES: 30, // prompt needs this many player answers before crowd data counts
  CROWD_WEIGHT: 0.5, // 0 = Wikidata only, 1 = crowd only (once enough samples exist)
  CROWD_TIMEOUT_MS: 1200,
};
