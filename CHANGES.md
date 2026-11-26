# Changes: linked answer store, bigger lists, worldwide balance (2026-11-26)
- **One answer, many questions.** Answers now live in `data/linked/` (format v3, `js/linked.js`). A person who is an actor *and* a singer from India is stored once, with a bit mask saying which questions he answers; aliases are stored once too. Related questions share a file group ("shard"): all questions about one country sit in `c-<country>`. Files are split into ~300 KB chunks (most famous answers first) and a question downloads only the chunks it needs; chunks are cached per session, so the second India question costs no extra download.
- **Honest numbers:** with today's data only ~2% of answers are shared between questions, so the file size went down by ~5% (23.1 MB to 21.1 MB raw, 8.0 MB gzip). The real payoff is the bigger lists below: obscure answers overlap a lot between "actor", "singer", "producer" of the same country.
- **Bigger lists.** The 2,000-answer limit is now 20,000 (`ANSWER_CAP`). Every category got a larger target (People/Film 10,000, Geography/Music/Sports/Nature 8,000, ...) and a lower popularity floor (8 Wikipedia languages instead of 20-40 for many lists). The real growth arrives through the "Build question data" GitHub Action (it accumulates over its daily runs); nothing was downloaded from Wikidata in this change.
- **Asia, without bias.** 20 Asian and Middle-Eastern countries were added (Sri Lanka, Nepal, Afghanistan, Iraq, Israel, UAE, Malaysia, Singapore, Myanmar, Kazakhstan, Uzbekistan, Taiwan, Jordan, Lebanon, Syria, Kuwait, Qatar, Mongolia, Cambodia, Bhutan) *and* 23 countries from Africa, Latin America, Europe and Oceania. New question kinds for every region: film, TV series, band, dish, newspaper, political party, airport, stadium, company, bank, hospital, mosque and Hindu temple (where relevant) plus film director, musician, composer, scientist, journalist, businessperson and screenwriter. About 1,170 base questions were added (catalog 474 -> 1,647 base questions, still exactly 10,000 total; the rest are derived "starts with" questions).
- **Tooling.** `node scripts/linked-store.mjs unpack|pack|stats`. The build workflow unpacks before building and packs afterwards; patch-packs/enrich-packs need `unpack` first. `validate-data.mjs` checks chunk hashes, sizes and that every question points at real chunks; all 1,198 anchor checks run through the real matcher on the linked data. 94 old "starts with" packs that are no longer in the catalog were pruned.
- **Slow, readable descent.** After a scoring answer the question now fades out, the craft sinks and a "Descending / 1,240 m" readout counts up for 3-5 s (longer for rarer answers) before the next question rises in. Scene easing is slower too. Reduced-motion setting keeps the old quick hand-over.
- **Wrong answers no longer move the region.** The scene used to drift deeper with every question asked, even misses. It now follows only the depth you earn, so a miss or a timeout never changes the zone.
- **Star on GitHub** button on the home and results screens.

# Changes: fairer, more fun dives (2026-11-24)
- **Difficulty curve.** Every dive now starts with questions most people can answer and ramps up: slots are easy, easy, easy, medium, medium, medium, hard (`planDive` in `js/engine.js`). Difficulty comes from `data/prompt-meta.json`, generated offline by `scripts/build-prompt-meta.mjs` from how many well-known answers each pool has. Categories are still spread across the dive.
- **Thin questions are not served in dives.** 55 packs (packs with fewer than 30 answers or almost no well-known answers, such as moons) are marked level 0 and skipped, because most correct-sounding answers would be rejected. Themed packs still use them. They come back automatically when a Wikidata rebuild gives them real pools; re-run the script after a rebuild.
- **Far fewer obscure "starting with <letter>" questions:** at most one per dive, never an opener, only on letters with 25+ answers.
- **Swap button:** once per dive, throw away the current question for a fresh one of the same difficulty (two spares are loaded in advance; the timer restarts).
- Tests added to `scripts/selftest.mjs` for the planner (ramp, no repeats, at most one letter question, deterministic).
- Daily Dive is no longer identical for everybody (this was already the case since an earlier change); it follows the same difficulty curve.
# Changes: reptile fix and bigger answer lists (2026-11-24)
- **Birds were counted as reptiles.** In Wikidata birds descend from Reptilia, so the reptile questions (base and "starts with <letter>") were mostly birds. The reptile query now excludes Aves (`notParent` in `js/catalog.js`, `js/wikidata.js`), and the existing reptile packs were cleaned (about 10,000 wrong entries removed).
- **More accepted answers.** Answers that only existed in the "starts with <letter>" packs were folded back into the main pack (bird, mammal, amphibian and reptile now hold 2,000 each, up from about 1,000), and every pack was re-cleaned with the current alias rules (about 31,600 more accepted aliases, 211 duplicates removed). Script: `scripts/enrich-packs.mjs` (offline; re-run it any time).
- Regression test: the reptile pack must not accept a bird.
- Not changed: the real Wikidata rebuild is still the way to reach 2,000 answers for the other questions; this only uses data we already have.

---

# Changes: famous answers, mobile lag, data build (2026-11-23)

## 2026-11-25 — Wrong answers no longer end the question

- A wrong (unrecognised) or already-used answer now shakes the field, clears it and lets the player try again while the timer keeps running. The question only ends on a correct answer or when time runs out (then 0 pts, as before).
- The results list shows what was tried on a timed-out question.

## 2026-11-25 — Progress steps, tier flash and dive log (ideas from a Krillion design guide, own look)

- **Seven progress steps** above each question. They fill in the rarity-tier colour as you answer; a miss leaves a dashed mark and the current step glows.
- **Tier flash** after every answer: the tier name in its colour plus "+points · sink metres" (or Miss / Repeat).
- **Dive log chart** on the results screen: one drop per prompt falling as far as its points, ending in a glowing orb in the tier colour; misses are hollow circles at the surface. The scale adapts so common-answer dives still draw a readable chart.

## 2026-11-25 — A living dive

- **A boat on the sea.** The game now starts with the craft floating on the surface (mast, flag, blinking beacon, ripples). Each correct answer sinks it: it tips nose-down, splashes through the waterline, trails bubbles, and plankton streams upward while it descends.
- **Scenes change as you go deeper.** A banner names each new zone ("Entering Twilight zone"). Wildlife belongs to its zone and swaps slowly: sunlight reef (clownfish, blue tang, butterflyfish, anthias, pufferfish), twilight hunters (tuna, mahi-mahi, snapper, lionfish), midnight (hatchetfish, lanternfish, viperfish, jellyfish), abyss (anglerfish with glowing lure, gulper, blue lanternfish, ghost eel).
- **Real fish, not silhouettes.** Real colour schemes, fuller bodies, smaller natural fins, glowing light organs for deep species, crisper cached sprites. They swim sideways in the direction they face, in their own lanes, nearer fish faster and brighter.
- Fish counts were reduced slightly (High 18, Medium 10, Low 7) so the water is not crowded. Measured at 4x CPU throttle: Low about 54 fps, Medium about 29 fps (previously 55 / 32).

## 2026-11-25 — Data build now targets the real question lists

- The automatic Wikidata rebuild was spending almost all its time on ~9,500 "starts with <letter>" variants whose pools are tiny (the last run built 0 packs). The game already derives letter questions from the main answer list, so the build now skips them by default (`--letters` or `--only` brings them back).
- Every daily run now rebuilds all 474 real prompts and pages one step deeper into Wikidata's candidates (6-day cycle), so answer lists keep growing toward 2,000 per question instead of stalling.
- Chained runs stop once the real prompts are covered (no more empty batches 1–19).

## 1. Famous answers were being rejected (China, Paris, Tokyo, Madagascar, Kilimanjaro...)
Causes and fixes
- `js/catalog.js`: "Name a capital city" now means "is the capital (P36) of a sovereign state" (it was a generic settlement class, so the pool held Krasnodar and no London). Geography classes and the "<class> in <country>" matrix use the subclass closure, so things typed as a subtype (big city, volcano subtypes, private university, island nation...) are found.
- `scripts/data-quality.mjs`: aliases are now ranked and capped at 25 (was 12, unranked, which cut "China" for "People's Republic of China"); official-name prefixes ("Republic of", "Kingdom of", ...) are removed as aliases; an override `add` never duplicates an existing answer; `C`, `C++`, `C#` stay distinct.
- `js/engine.js`: "Did you mean...?" ignores short aliases (under 7 letters) and prefers main labels, so Paris can no longer become "Poti" through a Georgian alias. Exact matching is unchanged.
- Anchors (famous must-accept answers) went from 165 to 452 questions. `scripts/validate-data.mjs` now sends every anchor through the real game matcher and fails on any rejection (it used to only check the answer was present somewhere in the file). `scripts/build-data.mjs` guarantees anchors, reports every one it had to add by hand (`BUILD-REPORT.json` -> `anchorsInjected`: that means the Wikidata query is too narrow), and refuses to write a pack that still fails.
- `scripts/patch-packs.mjs` (offline) repaired the packs already on the site: 330 packs. The answers it added by hand are listed in `data/ANCHORS-ADDED-BY-HAND.json`. National capitals come from `data/overrides.json` (generated by `scripts/curated-capitals.mjs`). Two adult-film entries were removed from `film-genre`.
- Regression tests in `scripts/selftest.mjs`, including the real packs: country/China, capital/Paris, city/Tokyo, island/Madagascar, mountain/Kilimanjaro, volcano/Mount Etna, river/Nile.

## 2. Mobile lag (`js/scene.js`)
Method: Pixel 5 emulation, 4x CPU throttle, 3-second requestAnimationFrame sample, headless Chromium with no GPU (absolute numbers are pessimistic; compare them with each other). Frame cost was measured by switching each layer off in turn.

| | before | after |
|---|---|---|
| Low tier, in a dive | 10.4 fps | **47.1 fps** |
| Medium tier | 6.1 fps | **23.0 fps** |
| High tier | 3.7 fps | **14.4 fps** |
| Low tier, giant-fish scene | 8.8 fps | **31.3 fps** |
| Medium tier, giant-fish scene | 4.1 fps | **21.8 fps** |

What changed: the biggest costs were the reef/kelp layer (about 60 ms of a 112 ms frame) and the water layer (about 45 ms). Water, surface, rocks and coral are now painted once into small cached canvases and drawn with one `drawImage`; `shadowBlur` is gone from the per-frame path; bubbles come from one sprite; on Medium and Low, fish are drawn from cached swim frames; each tier now also lowers fixed costs (cache resolution, caustics, kelp count, DPR cap of 1.5 on touch screens, 30 fps cap on Low). Auto mode starts low-power phones on Low and steps down High -> Medium -> Low after two slow 2-second windows in a row (it never steps back up) and remembers the result. Medium is no longer slower than Low.
Not measured: a real phone. Please check on one and report back; add `?perf` to the address to see fps and tier.

## 3. Data build kept being cancelled
The "Build question data" run hit the 170-minute job limit (GitHub shows a timeout as "cancelled") and lost everything because nothing is committed until the end. `build-data.mjs` now stops cleanly at `--max-minutes` (workflow default 140), saves what it built, and the workflow queues a new run from `stoppedAt`. The `wide` input text now says 2,000.
Not tested: against live Wikidata (the build sandbox cannot reach it).

---

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


## Mobile performance fix — 2026-11-22
- `css/style.css`: touch/small-screen panels no longer use backdrop blur; the canvas filter and vignette are disabled; large shadows/glows are reduced; timer/gauge/toast transitions are transform/opacity based.
- `js/scene.js`: added Auto/High/Medium/Low quality tiers, touch-device DPR caps (High 2, Medium 1.5, Low 1), lower creature counts, 30fps Low-tier pacing, 2-second auto-downgrade, hidden-tab pause, and an opt-in `?perf` overlay. The full-screen per-frame pressure gradient was replaced by a cheap translucent overlay.
- `js/main.js`: timer progress now uses `transform: scaleX()` and only repaints when the visible value changes; the 100ms layout-writing interval was removed.
- `js/state.js`, `js/ui.js`, `index.html`: added a persistent Graphics quality setting (Auto/High/Medium/Low).
- Before: touch devices used DPR up to 2, about 24 bubbles/60 plankton/18 fish/3 jellyfish, plus stacked CSS blur/filter effects. Timer wrote layout width every 100ms.
- After: Auto selects Medium on touch and Low on constrained touch hardware; Low uses DPR 1, 12 bubbles/20 plankton/10 fish/2 jellyfish and 30fps pacing. Timer uses compositor transform updates instead of width layout.
- Measurement note: no real-device Chrome DevTools 4x/6x Performance profile was available in this environment, so no fabricated before/after FPS or frame-time numbers are claimed.
