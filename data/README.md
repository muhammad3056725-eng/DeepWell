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

## First full 10,000-prompt build

After merging the data-pipeline change, open **GitHub → Actions → Build question data → Run workflow** and use these inputs:

| Input | First-run value |
|---|---|
| `only` | Leave blank |
| `wide` | `true` |
| `batch` | `0` |
| `batch_size` | `500` |
| `candidate_offset` | `0` |

The successful run queues batches 1 through 19 automatically. Keep the workflow's existing `build-data` concurrency group enabled; it deliberately serializes requests to the public Wikidata endpoint. Do not choose `batch=all` for the first run: that disables chaining and tries the entire catalogue in one hosted job.

Plan for roughly **12–30 hours overall**, spread across the 20 queued runs; actual time depends on Wikidata response times, how many popularity bands each prompt needs, and endpoint throttling. Each run has a 170-minute Actions limit and each SPARQL request is cut off at 55 seconds. If a shard repeatedly approaches its job limit, rerun the remaining range with a smaller `batch_size` (for example 100) and continue with the next 0-based batch index. The build is network-dependent and has not been run as part of the offline PR checks.

After a run, open `data/REPORT.md`:
- The first section gives total packs, answers, raw size and manifest version.
- Category coverage shows question counts, answer totals and median pool size.
- The next tables list the 20 smallest pools and 20 highest rejection rates.
- Fallback and change sections show retained previous packs, added/removed answers and query splits.
- The repository-size section compares the pack directory with the 60 MiB budget.

For a local offline check, run `npm test`, then `npm run validate-data` (which backfills legacy hashes before validation), then `npm run report-data`. The generated `data/REPORT.md` is written locally; commit it only when it reflects the build you intend to publish.
