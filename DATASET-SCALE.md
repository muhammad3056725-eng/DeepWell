# DEEPWELL question and answer library

## Target

- **10,000 distinct question prompts** in the catalog.
- **At most 1,000 valid answers per prompt**.
- Search up to 5,000 high-quality Wikidata candidates, then filter and save no more than the prompt's answer limit.
- Never invent, duplicate or pad answers to reach 1,000.

The catalog keeps the original base prompts and creates distinct A–Z variants such as **“Name a food starting with F”** and **“Name a river in Pakistan starting with M.”** The food-F prompt uses Wikidata's broad food class (Q2095) and filters English labels by their first letter. Some letter/category combinations may have fewer than eight answers and will be skipped by the game rather than padded.

## Variable answer-pool sizes

Every prompt has a hard maximum of 1,000. Its actual pool can be smaller because the source may contain fewer valid records. The chemical-elements prompt is explicitly capped at 118; its letter variants inherit that ceiling. Other finite topics (for example, capitals, planets or awards) naturally keep only the records returned by the source.

The game requires at least eight valid answers before a prompt can be played. Endless and category-pack modes can query Wikidata live for a selected prompt whose offline pack has not been built yet. Daily Dive remains deterministic and uses only saved packs or seed data.

## Current verified baseline

Before the 10k expansion, the repository contained:

- 473 base catalog prompts
- 415 generated answer packs
- 212,373 answer records
- 11.65 MiB across the 415 pack files

The pack inventory was measured from the Git tree, and the answer total came from the successful data-build log. The 10,000-prompt catalog is a prompt library expansion; it does not mean all 10,000 answer packs have already been downloaded or verified.

## Building the library in batches

A complete build should not run as one unbounded job. The GitHub Actions workflow now builds 500 prompts per batch by default. Select batches **0 through 19** to cover the 10,000-prompt catalog. The weekly schedule rotates through those batches. You may use a smaller batch size when Wikidata is slow.

Each pack stays independent. Failed or thin refreshes do not delete a previously working pool. The runtime also applies the answer cap when loading older packs.

## Storage estimate

The theoretical maximum is 10 million answer records (10,000 × 1,000). At the current measured storage density, that is roughly 550 MiB of JSON pack data before application files and deployment overhead. This is a rough estimate, not a claim that every prompt will reach 1,000 answers; many will be substantially smaller. Track the actual deployed size as batches are built, and move data shards to object storage/CDN before the published site approaches its hosting limit.
