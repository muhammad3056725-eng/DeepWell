# DEEPWELL

A rare-answer space flight. Seven prompts, one timer, and the rarer your answer the higher your rocket climbs: sky, orbit, the planets, black holes, other galaxies.
Static site for **deepwell.games**, served by GitHub Pages. No server and no build step for the game itself.

## How it works

- **Questions:** `js/catalog.js` defines 470+ question types ("Name a river", "Name a mountain in Italy", "Name a film director"). Each carries a Wikidata pattern that defines its answer pool.
- **Answers:** `scripts/build-data.mjs` queries Wikidata and writes one file per question; `scripts/linked-store.mjs pack` then folds them into the linked store `data/linked/` (one row per answer, shared by many questions, chunked). A GitHub Action refreshes them daily. See `CHANGES.md`.
- **Rarity:** an answer's score is its percentile rank by Wikipedia language count inside its pool: best known is about 3 points, rarest is 100. Climb per scoring answer = 280 units + points x 9 units (internally still called depth); units map to altitude: Moon, Mars, Sun, Jupiter, Neptune, light-years, galaxies (`unitsToKm` in `js/config.js`).
- **Crowd data (optional):** set `CROWD_ENDPOINT` in `js/config.js` (see `docs/crowd-backend.md`) and real player answer shares are blended into the score once a prompt has enough samples.
- **Daily Flight:** one personalized seven-prompt challenge per player each UTC day. Daily, Endless and themed flights share question history to avoid repeats until the unused pool is exhausted. Daily resets 00:00 UTC.
- **Fallbacks:** pre-built pack, then bundled seed lists (`js/seed/`), then live Wikidata (Endless and packs only).

## Run locally

```bash
npm run serve      # then open http://localhost:8080 (ES modules need a server)
npm test           # offline self-test
npm run build-data # pull data from Wikidata (needs internet, slow)
```

## Deploy

Push to `main`, then Settings > Pages > Deploy from branch > `main` / root. `CNAME` holds `deepwell.games`.
Run the **Build question data** workflow once to fill `data/packs/`.

## Add a question type

Add one entry in `js/catalog.js`. Register every Q-id through `inst(...)`, `occ(...)` and the other helpers so the build can verify it against Wikidata, then rebuild that pack: `node scripts/build-data.mjs --only your-id`.
