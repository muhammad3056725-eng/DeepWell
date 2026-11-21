// Offline seed bank: a small hand-curated fallback so the game works before the first
// Wikidata build and when the player is offline. Format per prompt id:
//   "Name|Name=alias=alias|Name"  ordered from best known to most obscure.
// Rank order stands in for popularity, so keep each list sorted that way.
// Real packs in data/packs/ replace these automatically once they are built.
import { SEED_GEO } from './seed/geo.js';
import { SEED_SCIENCE } from './seed/science.js';
import { SEED_CULTURE } from './seed/culture.js';

export const SEED = { ...SEED_GEO, ...SEED_SCIENCE, ...SEED_CULTURE };
