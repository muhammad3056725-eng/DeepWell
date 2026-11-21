# DEEPWELL

A rare-answer descent. Seven prompts, one timer, and the rarer your answer the deeper you dive.
Static site for **deepwell.games**, served by GitHub Pages. No server and no build step for the game itself.

## How it works

- **Questions:** `js/catalog.js` defines 470+ question types ("Name a river", "Name a mountain in Italy", "Name a film director"). Each carries a Wikidata pattern that defines its answer pool.
- **Answers:** `scripts/build-data.mjs` queries Wikidata and writes `data/packs/<id>.json` (name, aliases, Wikipedia language count). A GitHub Action refreshes them every Monday.
- **Rarity:** an answer's score is its percentile rank by Wikipedia language count inside its pool: best known is about 3 points, rarest is 100. Depth = points x 10 m.
- **Crowd data (optional):** set `CROWD_ENDPOINT` in `js/config.js` (see `docs/crowd-backend.md`) and real player answer shares are blended into the score once a prompt has enough samples.
- **Daily Dive:** seeded by the UTC date, so everyone gets the same seven prompts. Resets 00:00 UTC.
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
