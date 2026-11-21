# DEEPWELL answer-data scale

## Current verified baseline

At the 2026-11-21 data build, the repository contained:

- 473 catalog prompts
- 415 generated answer packs
- 212,373 answer records
- 11.65 MiB across the 415 pack files

The pack inventory was measured from the Git tree, and the answer total came from the successful data-build log.

## Why 20,000 × 1,000 is a different hosting problem

A requirement of 20,000 prompts with at least 1,000 distinct, valid answers each means at least 20 million answer records. At the current stored size per record, a first-order estimate is roughly 1.1 GB of uncompressed pack data, before the application files and indexes. The estimate is not a promise of exact final size.

GitHub Pages documents a maximum published-site size of 1 GB. The complete target therefore should not be pushed blindly into the Pages deployment. Put large data shards in object storage/CDN and keep the game shell and a small manifest on Pages.

## Data-quality rule

Never pad a category with duplicates or unrelated entities just to reach 1,000. Some real prompts have a naturally small answer universe: a finite list of elements, capitals, awards or planets cannot honestly have 1,000 answers. Such questions should keep their true pool size or be excluded from a strict 1,000-answer tier.

## Safe expansion path

1. Use broad Wikidata class queries (including subclass relationships where appropriate), lower sitelink cutoffs and higher query limits.
2. Keep each question pack independent so a player downloads only the pack needed for the current prompt.
3. Keep an older pack when a refresh returns fewer records or fails.
4. Build and validate in batches, not one unbounded GitHub Actions job. The current public Wikidata builder deliberately rate-limits requests.
5. Publish validated shards to external object storage/CDN once the total dataset approaches the Pages limit.
6. Make the game select only prompts whose real answer pools meet the configured minimum for that prompt tier.

## Current implementation support

The data builder has a `--wide` mode that requests up to 5,000 results per prompt with a minimum sitelink count of 1. This increases the available candidate pool; it does not promise that every prompt has 1,000 valid answers.
