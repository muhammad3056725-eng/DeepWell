# DEEPWELL visual overhaul

## Files changed
- `index.html` — added the live depth-zone label and a four-band descent gauge; bumped the page and stylesheet cache keys.
- `css/style.css` — added zone-reactive accent colours, distinct Daily/Endless/Packs button gradients, a glass HUD, the depth gauge, results reveals, and predator-encounter focus styling.
- `js/scene.js` — expanded the Canvas 2D renderer with a golden-hour surface and moving waterline, smoothly blended sunlight/twilight/midnight/abyss palettes, layer-aware light, 8 ambient creature forms, marine snow, jellyfish and distant abyssal silhouettes. Added a player submersible with a depth-responsive lamp and a 6-species hinged-jaw predator encounter with random colours, sizes, approach direction, height and captions. Added reduced-motion handling, tab-visibility pause, and a low-frame-rate quality fallback.
- `js/audio.js` — added synthesized gulp and rare-answer sparkle effects tied to the existing Sound slider.
- `js/main.js` — connected Settings toggles to the scene and changed only timer-bar colour presentation; scoring, answer checks, dive progression and data calls are unchanged.
- `js/ui.js` — added the four-zone label and updates the gauge marker from the real depth.


# Dataset expansion and quality overhaul

- `js/catalog.js` — default new pools to a 2,000-answer target and a two-sitelink quality floor while retaining natural per-question caps.
- `js/data.js` — allow the lazy loader to consume pools up to 2,000 without changing its exported API.
- `js/wikidata.js` — add popularity-band query bounds, broader Latin-script alias properties, stricter label hygiene, compact v2 packs, and v1 read compatibility.
- `scripts/data-quality.mjs` — add offline duplicate/blocklist cleaning, alias generation and collision resolution, durable manual overrides, and meaningful-change detection.
- `scripts/build-data.mjs` — query popularity bands sequentially, respect Retry-After and a 55-second timeout, split failed bands by initial, verify registered Q-ids, preserve previous packs on failures, and write only meaningful changes.
- `scripts/backfill-manifest.mjs` — add hashes, byte counts and quality metadata to existing v1 packs without rewriting them.
- `scripts/validate-data.mjs` — validate pack schemas, counts, ordering, duplicates, hashes, blocklist, anchors and size budgets offline; legacy v1 anchors are reported during migration and v2 anchors are enforced.
- `scripts/report-data.mjs` — generate category coverage, smallest pools, rejection rates, fallback and change summaries, plus repository-size checks.
- `data/anchors.json`, `data/blocklist.json`, `data/overrides.json`, `data/README.md` — add curated anchors for 165 core prompts, editable safety/override files, and maintenance documentation.
- `.github/workflows/build-data.yml` — run manifest backfill, validation and reporting before committing generated data.
- `package.json`, `scripts/selftest.mjs` — add validation/report commands and offline tests for v2 compatibility, expanded pools, band bounds, cleaning, aliases, overrides and no-op writes.
