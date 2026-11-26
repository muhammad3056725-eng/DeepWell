# APOGEE

*(formerly DEEPWELL; the domain deepwell.games, the `/deepwell/` URL and the repository name are unchanged.)*

A rare-answer space flight. Seven broad prompts, one timer, and the rarer your answer the higher your rocket climbs: sky, orbit, the planets, black holes, other galaxies.
Static site for **deepwell.games**, served by GitHub Pages. No server and no build step for the game itself.

## How it works

- **Questions are broad.** Two kinds, mixed in every flight:
  - **Everyday survey prompts** (`data/curated/*.txt`, about 90): "Name something people do at a party", "Name something you'd find in a kitchen", "Name a pizza topping", "Name a superpower you'd like to have". Hand-written answer lists of 60–200 answers each, ordered from most to least common.
  - **Knowledge prompts** (`js/catalog.js`, about 275): "Name a mammal", "Name a skyscraper", "Name an actor", "Name a river". Answers come from Wikidata (thousands per prompt). Common-name overlays in `data/curated/` make sure the obvious answers count too: "cat", "bear" and "whale" for mammals, "pineapple" for fruits.
  - Narrow prompts were removed: no "starting with X" variants and no "from <country>" splits.
- **Answers are stored once.** `data/linked/` is a single answer store (format v4, see `js/linked.js`): one row per answer with its aliases and popularity, and a small index per question that points at its rows. An answer that fits several questions ("pizza" answers party food, fast food and things you buy at a supermarket) is written once. About 204,000 answers, 13 MB raw / 5 MB gzipped.
- **Type it your way.** The matcher (`matchAnswer` in `js/engine.js`) accepts names, aliases, plurals, missing spaces or hyphens ("spiderman"), a single distinctive word ("winston" → Winston Churchill, "petronas" → Petronas Towers), typos ("margret thatcher") and sound-alike spellings ("chaikovsky"). Confident matches count at once and the game says what they were counted as; a doubtful one asks "Did you mean …?". Generic words ("lake") never count on their own.
- **Rarity:** an answer's score is its percentile rank by popularity inside the prompt's pool: best known is about 3 points, rarest is 100. Wikidata answers use the number of Wikipedia language editions; curated answers use their place in the hand-ordered list. Climb per scoring answer = 280 units + points × 9 units; units map to altitude (`unitsToKm` in `js/config.js`).
- **Crowd data (optional):** set `CROWD_ENDPOINT` in `js/config.js` (see `docs/crowd-backend.md`) to blend real player answer shares into the score.
- **Daily Flight:** one personalised seven-prompt flight per player each UTC day (30 s per prompt). Flights alternate everyday and knowledge prompts, start easy and end with one hard prompt, and avoid prompts you have seen recently.

## Data workflow

```bash
npm run serve                               # then open http://localhost:8080/deepwell/
npm test                                    # offline self-test (engine, matcher, catalog, store)
node scripts/linked-store.mjs unpack        # store -> data/packs/<id>.json (Wikidata prompts)
node scripts/build-data.mjs --only actor    # refresh prompts from Wikidata (needs internet, slow)
node scripts/linked-store.mjs pack          # data/packs + data/curated -> store (answers stored once)
node scripts/build-prompt-meta.mjs && node scripts/validate-data.mjs
```

The **Build question data** workflow does the same every day and grows the Wikidata pools a little further each run.

## Add a question

- **Everyday prompt:** add a block to a file in `data/curated/` (format at the top of `party-fun.txt`), then run `node scripts/linked-store.mjs pack`.
- **Common names for a Wikidata prompt:** add an `@<prompt-id> | overlay | level | Prompt text` block.
- **Wikidata prompt:** add one entry in `js/catalog.js` (register every Q-id through `inst(...)`, `occ(...)` and the other helpers so the build verifies it), then `node scripts/build-data.mjs --only your-id` and pack.

**Hub note:** deepwell.games root is a four-game selection hub — see [HUB.md](HUB.md) before moving the game entry point or the root asset folders.
