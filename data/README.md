# DEEPWELL data maintenance

DEEPWELL is a static GitHub Pages site. Packs are plain JSON in `data/packs/`; the browser loads one pack lazily for each question.

## Add a question
Add it to `js/catalog.js`. Register every Q-id through the existing helpers (`inst`, `sub`, `occ`, `held`, `won`, `country`, `citizen`, `continent`). Never guess or inline Q-ids. Set `floor` (normally 2 Wikipedia language editions), `target` (normally 2,000), and a meaningful `minPool`. Add obvious answers in `data/anchors.json`.

## Overrides and blocklist
`data/overrides.json` survives rebuilds. Example:
`{"river":{"add":[{"n":"Vistula","a":["Wisla"]}],"remove":["Q123"],"aliasAdd":{"Q456":["nickname"]}}}`.
`data/blocklist.json` has editable `qids` and case-insensitive `words` arrays.

## Rebuild commands
- One pack: `node scripts/build-data.mjs --only river`
- Resume recent packs: `node scripts/build-data.mjs --resume`
- Verify registered ids only: `node scripts/build-data.mjs --verify-only`
- One shard: `node scripts/build-data.mjs --batch 0 --batch-size 500`
- Full catalogue: `node scripts/build-data.mjs --batch all` (long-running; prefer Actions)

The builder requests popularity bands from high to low, sequentially, waits between requests, sends a descriptive User-Agent, honours Retry-After and aborts at 55 seconds. Failed bands are split by initial letter; failed packs retain their previous files. More than 25% failed prompts abort the batch.

## Packs and reports
The loader reads v1 and v2. New packs use v2 parallel arrays and a sparse alias map. Run:
```sh
npm test
node scripts/backfill-manifest.mjs
node scripts/validate-data.mjs
node scripts/report-data.mjs
```
Validation is offline and checks hashes, counts, ordering, duplicates, anchors, blocklist and size budgets. The report is written to `data/REPORT.md`.
