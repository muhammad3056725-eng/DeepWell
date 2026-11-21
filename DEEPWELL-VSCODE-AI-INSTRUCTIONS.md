# DEEPWELL: instructions for the AI in VS Code

This file has two parts.

- **Part 1 is for you.** Set up the folder, the tools and the AI chat.
- **Part 2 is for the AI.** It turns your original single `index.html` into the finished multi-file game, step by step. Copy each step into the AI chat one at a time.

A finished, tested copy of the whole project is in `deepwell-final.zip`. Use it as the answer key: if the AI's result differs from it, compare and fix.

---

# PART 1: Setup (you)

## 1.1 Install

1. **VS Code**: https://code.visualstudio.com
2. **Node.js 20+** (LTS): https://nodejs.org. Check with `node --version` in a terminal.
3. **Git**: https://git-scm.com. Check with `git --version`.
4. VS Code extensions (Ctrl+Shift+X): **Live Server** (Ritwick Dey) and your AI assistant (Claude Code, Copilot, or similar). Use the AI's **agent / edit mode**, not plain chat, so it can create files.

## 1.2 Prepare the folder

1. Make a folder, for example `Documents/deepwell`.
2. Put your **original** `index.html` in it and rename it `index.original.html` (keep it as the reference).
3. Put this instruction file in the folder too.
4. VS Code: **File > Open Folder** and choose it.
5. Open a terminal inside VS Code (Ctrl+`) and run `git init`.

## 1.3 How to use Part 2

- Paste **one step at a time**. Wait until the AI finishes and the check at the end of the step passes.
- After each step run `git add . && git commit -m "step N"`. If a later step goes wrong you can go back.
- Start every new AI session by saying: *"Read DEEPWELL-VSCODE-AI-INSTRUCTIONS.md and index.original.html first. We are on step N."*
- Tell the AI: **"Do not write placeholder code or TODOs. Every function must be complete."**

---

# PART 2: Instructions for the AI

## 0. Context you must know

`index.original.html` is a single-file trivia game called DEEPWELL. The player gets 7 prompts ("Name a country in Africa"), types one answer each against a timer, and gains "depth" in metres based on how rare the answer is. It will be hosted on **GitHub Pages at deepwell.games**, so it must stay a **static site: no server, no bundler, no npm dependencies for the game**. Use plain ES modules (`<script type="module">`).

### Problems in the original (all must be fixed)

1. **Tiny, fake data.** Prompt data is generated from about 12 small hand-typed word lists. Each prompt is just the same list rotated.
2. **Fake rarity.** An answer's rarity is `8 + position*4`, so it depends on list order, not on how well known the answer is.
3. **Fake "internet" mode.** Endless mode calls a trivia API where each question has exactly one correct answer, so there is nothing to be rare about.
4. **Daily Dive uses the local date**, so players in different time zones get different prompts. Use the **UTC date**.
5. **Daily is marked complete when it starts**, so a page refresh loses the attempt. Mark it complete only when the dive finishes.
6. **`confirm()` for "did you mean"** is a blocking dialog and the timer was already stopped. Replace it with an inline box that pauses the timer.
7. **Fuzzy matching is too loose** for short words and can match unrelated answers.
8. **User text is put into `innerHTML`** in the results list (XSS risk). Escape everything.
9. **Settings "Reduced motion" and "Color-safe palette" do nothing.** Make them work.
10. **CSS bug:** `.result-grid div` and `.stats-list div` also match nested divs, which draws boxes inside boxes. Use child selectors (`>`).
11. **Streak logic** reads from a history array that is also used for other data. Use a dated log.

### Target file layout

```
index.html                       (markup only, loads js/main.js as a module)
css/style.css                    (the original CSS, fixed, plus additions)
CNAME                            (contains: deepwell.games)
.nojekyll                        (empty file)
package.json                     ({"type":"module", scripts: serve, test, build-data})
README.md
js/config.js     catalog.js   wikidata.js   engine.js   data.js
js/crowd.js      state.js     scene.js      audio.js    game.js
js/ui.js         main.js      seed.js       seed/geo.js seed/science.js seed/culture.js
scripts/build-data.mjs   scripts/selftest.mjs
data/manifest.json       data/packs/        (filled by the build)
docs/crowd-backend.md
.github/workflows/build-data.yml
```

---

## STEP 1: Split the original file

**Task:** without changing behaviour yet, split `index.original.html` into `index.html`, `css/style.css`, and `js/*.js`.

- Move everything inside `<style>` into `css/style.css`. In it, change `html,body{...overflow:hidden}` to `overflow-x:hidden`.
- Move the inline script into modules as in the layout above. Do the full rewrite in later steps; for now just prove the split works.
- In `index.html` use `<link rel="stylesheet" href="css/style.css">` and `<script type="module" src="js/main.js"></script>`. Add a `<noscript>` message, an SVG data-URI favicon, a meta description and Open Graph tags.
- Create `package.json` with `"type":"module"` and scripts: `serve` = `python3 -m http.server 8080`, `test` = `node scripts/selftest.mjs`, `build-data` = `node scripts/build-data.mjs --out data/packs`.
- Create `CNAME` containing exactly `deepwell.games`, and an empty `.nojekyll`.

**Check:** `npm run serve`, open http://localhost:8080 and confirm the home screen looks as before. (Double-clicking `index.html` will not work with modules.)

---

## STEP 2: `js/config.js`

Export a `CONFIG` object with exactly these keys:

```js
TITLE:'DEEPWELL', DOMAIN:'deepwell.games',
PROMPTS_PER_DIVE:7, DAILY_SECONDS:20, POINTS_PER_METER:10, MAX_DEPTH_VISUAL:4000,
MANIFEST_URL:'data/manifest.json', PACK_DIR:'data/packs',
WIKIDATA_ENDPOINT:'https://query.wikidata.org/sparql', LIVE_TIMEOUT_MS:9000,
MIN_POOL_FOR_LETTER:14,
CROWD_ENDPOINT:'', CROWD_MIN_SAMPLES:30, CROWD_WEIGHT:0.5, CROWD_TIMEOUT_MS:1200
```

**Check:** `node --check js/config.js`.

---

## STEP 3: `js/catalog.js` (the question catalog)

This replaces the fake prompt data. Each entry is a question type plus a **Wikidata pattern** that defines its answer pool.

**Exports:** `CATEGORIES`, `ENTITY_LABELS` (a `Map` of Q-id to expected lowercase English label), `CATALOG` (array), `CATALOG_BY_ID` (Map), `entityIdsOf(entry)` (returns the Q-ids found in `entry.pattern`).

**Categories (19):** Geography, Space, Science, Nature, Food, Music, Film & TV, Literature, Art, History, Sports, Games, Technology, People, Language, Mythology, Body, Brands, Transport.

**Entry shape:** `{id, cat, prompt, kind:'item'|'taxon', pattern, minSL, limit, minPool, people?}`

- `id`: unique kebab-case. Throw on duplicates.
- `pattern`: the SPARQL fragment placed after `?item`. Build with helpers that **register every Q-id with its expected label** so the build can verify it:
  - `inst(q,label)` -> `wdt:P31 wd:Q..` (instance of)
  - `sub(q,label)` -> `wdt:P31/wdt:P279* wd:Q..` (instance of a subclass)
  - `occ(q,label)` -> `wdt:P106 wd:Q..` (occupation), `held` -> P39, `won` -> P166, `country` -> P17, `citizen` -> P27, `continent` -> P30
  - Join conditions with `;`, for example `` `${inst('Q515','city')}; ${country('Q668','india')}` ``.
- `minSL`: minimum Wikipedia language editions (the popularity signal). `limit`: max rows. `minPool`: the pack is rejected if it has fewer answers.
- `kind:'taxon'` entries (animals, plants) use the pattern `wdt:P171+ wd:<parent>; wdt:P105 wd:<rank>`. Their display name is the English common name (P1843).
- `people:true` marks person classes so surnames can be accepted.

**Size and mix (target 470+ entries):**

- Geography: about 40 world classes (country, capital, city, island, river, mountain, lake, volcano, desert, sea, waterfall, national park, bridge, castle, university, airport, stadium, and so on), six "country in <continent>" entries, and class-by-country matrices ("city in India", "river in Germany", "university in Pakistan", "football club in Spain"; 40 countries for cities, 10 to 20 for the others).
- Space (14), Science (12), Nature (10, taxon-based: mammal, bird, reptile, amphibian, insect, flowering plant, dinosaur, shark, plus dog and cat breeds), Food (13), Music (16 incl. singer, rapper, composer), Film & TV (12), Literature (14), Art (10), History (18 incl. US presidents, popes, monarchs), Sports (11), Language (10), Mythology (6), Body (6), Games (8), Technology (10), Brands (8), Transport (4).
- People: Nobel winners by prize, scientists by field, plus nationality splits ("cricketer from India", "poet from Pakistan", "writer from Russia", and so on).

**Rules:**
- Never guess a Q-id. If you are not sure an id is right, leave the entry out. A wrong id would create a mislabeled question. The build script (Step 12) checks every id against Wikidata labels and skips mismatches.
- Do not add Wikidata classes whose answers would be tiny, offensive, or private individuals who are not public figures.

**Check:** `node -e "import('./js/catalog.js').then(m=>console.log(m.CATALOG.length,m.ENTITY_LABELS.size))"` prints 400+ entries and no duplicate-id error.

---

## STEP 4: `js/wikidata.js`

Pure functions (no DOM, no Node-only APIs) shared by the browser and the build script.

- `buildQuery(entry, overrides)`: returns a SPARQL string.
  - Items: select `?item ?itemLabel ?sl` plus `GROUP_CONCAT(DISTINCT ?alt; separator="|")` of English `skos:altLabel`. The **inner sub-select** picks the top `limit` items by `wikibase:sitelinks ?sl`, filtered by `?sl >= minSL`, ordered by `DESC(?sl)`. The label service runs outside the sub-select.
  - Taxon: inner sub-select on `?item wdt:P31 wd:Q16521` (taxon) plus the pattern; outer joins English common names (`wdt:P1843`) and optional scientific names (`wdt:P225`) as aliases.
- `buildLabelQuery(qids)`: `VALUES ?q {...} ?q rdfs:label ?l FILTER(LANG(?l)="en")`.
- `parseBindings(json, entry)`: returns `[{id, n, s, a:[]}]`. **Skip** rows whose label is missing, looks like a raw id (`/^Q\d+$/`), or is longer than 70 characters. **Skip duplicate names** (case-insensitive); the first, most-linked one wins. Aliases are deduped against the label and each other, max 8.
- `queryUrl(endpoint, sparql)`: `?format=json&origin=*&query=...`.
- `fetchLive(entry, {endpoint, timeoutMs, fetchImpl})`: uses `AbortController`, limit capped at 600 for speed, throws on non-OK.
- `toPack(entry, items)` returns `{v:1, id, built:'YYYY-MM-DD', items:[[numericId, name, sitelinks, aliases]]}`; `fromPack(pack)` reverses it. This compact array form keeps files small.

**Check:** `node --check js/wikidata.js`.

---

## STEP 5: `js/engine.js` (matching, rarity, picking; no DOM)

Implement and export exactly these. The numbers matter.

**Normalising and matching**
- `normalize(v)`: lowercase; `&` becomes ` and `; strip accents (NFD, remove U+0300 to U+036F); map `ß`->`ss`, `ø`->`o`, `æ`->`ae`, `œ`->`oe`, `ł`->`l`, `đ`->`d`; replace anything not `a-z0-9 ` with a space; remove the words `the`, `a`, `an`; collapse spaces; trim.
- `distance(a,b,max=3)`: Damerau-Levenshtein (transposition counts as 1) that returns `max+1` early when the distance must exceed `max`.
- `matchAnswer(input,pool)` returns `{item, exact:true}`, `{item, near:true}` or `null`.
  1. Exact lookup in `pool.exact` (a Map of normalised key -> item) -> exact.
  2. If the normalised input is shorter than **5** characters: no fuzzy match.
  3. Otherwise fuzzy: only compare keys with the **same first letter** and a length difference within the limit. Limit = 1 edit if the key is under 8 characters, 2 if under 13, else 3. Pick the smallest distance (tie: the better-known item).

**Rarity (this replaces `8 + j*4`)**
- `assignRarity(items)`: sort by `s` (Wikipedia language count) descending. Items with equal `s` share a mid-rank. For an item at rank positions i..j in n items: `p = n>1 ? (i + (j-i)/2)/(n-1) : 0.5`, then `r = clamp(round(3 + 97 * p^1.1), 3, 100)`. Store `p` and `r`. The best-known answer is about 3 points, the rarest 100.
- `tier(points)`: <=20 Common, <=40 Familiar, <=60 Uncommon, <=80 Rare, <=94 Very Rare, else Singular. `tierClass(t)` returns `'tier-' + lower-case, spaces to dashes`.
- `blendPoints(base, crowd, {minSamples=30, weight=0.5})`: if `crowd.total < minSamples` return `{points: base, crowdUsed:false}`. Otherwise `share = count/total`, `crowdPts = clamp(round(3 + 97*(1 - sqrt(share))), 3, 100)`, `points = round((1-weight)*base + weight*crowdPts)`.

**Pools**
- `buildPool(raw, {people})`: raw items are `{id,n,a,s}`. Run `assignRarity`. Build `exact` (normalised name or alias -> item; the better-known item keeps a contested key; names are claimed before aliases) and `keys` (array of `[key,item]`). With `people:true`, also accept a **unique** surname (last token, at least 4 letters, appears for only one item, not already a key). Return `{items, exact, keys, size, raw}`.
- `letterOptions(pool,min)`, `deriveLetterPool(pool,letter,opts)` (rebuilds a pool from `pool.raw` filtered by first letter, so rarity is recomputed inside it), `firstLetter(name)`.

**Seeded picking**
- `hashString` (FNV-1a 32-bit), `mulberry32(seed)`, `shuffle(arr,rnd)`.
- `pickEntries(entries,count,rnd,{avoid,category})`: prefer entries not in `avoid`; group by category; shuffle the sorted category list; take one random entry from each category in round-robin so that Geography and People (which have the most entries) cannot dominate. Each pick is `{entry, variantRoll, letterRoll}`, both rolls drawn from `rnd` so seeded runs are fully deterministic.
- `chooseVariant(pick,pool,{minPool,chance=0.3})`: if `variantRoll < chance`, at least 3 letters have `minPool`+ answers and `pool.size >= minPool*3`, return `letters[floor(letterRoll*letters.length)]`, else `null`. The prompt then reads "Name a river starting with M".
- `promptKey(entry,letter)`, `promptText(entry,letter)`.
- `utcDate(d)` returns `toISOString().slice(0,10)`; `previousUtcDate(str)`.

**Check:** `node --check js/engine.js`.

---

## STEP 6: Seed data and `js/data.js`

**Seed lists (offline fallback).** `js/seed.js` merges `SEED_GEO`, `SEED_SCIENCE`, `SEED_CULTURE` from `js/seed/*.js`. Each value is one string for one catalog id: `"Name|Name=alias=alias|Name"`, ordered **from best known to most obscure** (rank stands in for popularity). Cover at least: country, capital, island, river, mountain, lake, volcano, desert, sea, us-state, chemical-element, moon, constellation, programming-language, language, currency, instrument, music-genre, sport, board-game. Each list needs 30+ real entries. Every seed id must exist in the catalog.

**`js/data.js`**
- `loadManifest()`: fetch `data/manifest.json` with `cache:'no-cache'`; on any failure keep an empty manifest `{version:0,built:null,packs:{}}`.
- `hasPack(id)`, `hasSeed(id)`, `stableEntries()` = catalog entries with a pack **or** a seed (the only ones the Daily Dive may use).
- `libraryStats()` returns `{prompts, packs, answers, built, stable}`.
- `parseSeed(entry)`: split on `|`, then `=`; dedupe by normalised name; `s = length - index`.
- `loadRawPool(entry,{allowLive})`: cached per id. Order: pack file (`data/packs/<id>.json?v=<manifest.version>`, rejected if it has fewer than `min(minPool,8)` items) -> seed (needs 8+ items) -> live Wikidata (only if `allowLive`, needs `min(minPool,12)`+ items). Returns `{items, source:'wikidata'|'seed'|'live'}`. Throws if nothing works.

**Check:** `node --check js/data.js js/seed.js js/seed/*.js`.

---

## STEP 7: `state.js`, `crowd.js`, `audio.js`, `scene.js`

- **`state.js`**: storage key `deepwell-v2`. `store` = `{games,total,best,streak,bestStreak,dailyLog:{date:{depth,answers}},recentPrompts:[],misses,settings:{sound:.45,haptics:true,motion:false,color:false,timer:20,text:1}}`. Wrap every `localStorage` access in try/catch with an in-memory fallback. Exports: `load`, `save`, `dailyDone(date)`, `recordDive({mode,depth,answers})` (updates games/total/best; for daily also logs the date and sets `streak = dailyLog[yesterdayUTC] ? streak+1 : 1`), `liveStreak()` (0 if neither today nor yesterday was played), `rememberPrompts(ids)` (keep the last 400).
- **`crowd.js`**: `crowdEnabled()` is true only if `CROWD_ENDPOINT` is set. `crowdStats(promptKey,answerKey)` does `GET /stats?p=&k=` with a timeout and returns `{count,total}` or `null`. `crowdSubmit` does a fire-and-forget `POST /submit` with `{p,k}`. All failures are silent.
- **`audio.js`**: `wake()`, `tone(freq,dur,type)`, `setVolume`, `buzz(pattern)` using WebAudio and `navigator.vibrate`, all guarded.
- **`scene.js`**: the original canvas background moved into `startScene(depthFn, stillFn)`. Cap `devicePixelRatio` at 2. When `stillFn()` is true (Reduced motion), particles and the diver do not move.

**Check:** `node --check` each file.

---

## STEP 8: `js/game.js` (building a dive)

- `prepareDive({mode, category, recent})` returns exactly 7 prompts or throws.
  - **Daily:** candidates are `stableEntries()` only, no live queries, RNG = `mulberry32(hashString('deepwell-daily-' + utcDate()))`, nothing avoided. Same date + same data = same seven prompts for every player.
  - **Endless / pack:** random seed, avoid `recent`. If the stable entries (in the category, for packs) number fewer than `count + 3`, include all catalog entries and allow live Wikidata; otherwise use stable entries only.
  - Draw `count + 10` candidates with `pickEntries`, then load them in batches of the number still missing. A candidate that fails to load or has fewer than 8 answers is skipped; keep candidate order so the daily stays deterministic.
  - Each ready prompt is `{entry, letter, pool, source, key, text, cat}`. Apply `chooseVariant`; if the letter sub-pool has fewer than 8 answers, fall back to the plain prompt.
- `examples(pool)`: two best-known answers and one rare answer (item at 85% of the sorted list), for the results screen.

---

## STEP 9: `js/ui.js` and `index.html` changes

- `index.html` additions: a `.src-badge` span in the progress row, an inline confirm box (`#confirmBox` containing `#confirmName`, `#confirmYes`, `#confirmNo`), a `#library` line on the home screen, a themed-packs grid `#packActions`, a timer option of 45 s, an updated How-to-play text that explains Wikidata-based rarity honestly (rarity = how many Wikipedia language editions have an article, plus real player data when available), and settings text that says the Daily Dive always uses 20 s and resets at 00:00 UTC.
- `css/style.css` additions: `.src-badge`, `.confirm`, `.library`, `.loading`, `.breakdown .row`, `body.reduced` (no animation or transition), `body.colorsafe` (override `--cyan`, `--pink`, `--green`), `.cat-grid`. Change `.result-grid div`, `.stats-list div` to `>div`, and delete the old `.breakdown div` rule.
- `ui.js` exports: `$`, `esc` (HTML-escape `& < > " '`), `show(id)`, `toast`, `updateDepthUI(depth)` (meter height `min(92, 20 + depth/100)%`), `renderHome` (daily button shows "Completed - N m"; countdown to 00:00 UTC; library line shows answer count and build date, or "Starter set" before the first build), `renderStats` (dives, daily streak, best streak, best depth, average, daily status, unrecognised answers), `renderResults(run,streak)`, `buildPackButtons`, `applySettings`, `loadSettingsUI`, `readSettingsUI`.
- **Every** user-provided or data-provided string that reaches `innerHTML` must pass through `esc()`.
- In the results list show, per prompt: the prompt text, the answer (and what the player typed if different), the points and tier, and for answers worth under 40 points a hint such as "You could have said: <famous>, <rare>".

---

## STEP 10: `js/main.js` (the game loop)

- **Start:** `startDive(mode,category)`. Block the daily if `dailyDone()`. Use a `runId` counter so a slow load that finishes after the player left is ignored. Show "Finding questions..." and disable the input while loading. On failure show a toast and go home. Remember prompt keys for non-daily runs.
- **Timer:** a 100 ms interval that subtracts elapsed time (not a fixed end time) so it can be paused. Pink bar under 5 s with a tick sound. **Do not** pause when the tab is hidden (the original did; it allows looking answers up). Daily timer = `DAILY_SECONDS`; others use the setting.
- **Submit:** ignore empty input. Run `matchAnswer`. Exact -> score. Near -> show `#confirmBox`, set `run.paused=true`; Yes scores the matched item, No hides the box and lets the player retype with no penalty. No match -> miss and `store.misses++`.
- **Scoring:** points = `item.r`. Repeats (same `item.id`) score 0. If `crowdEnabled()`, fetch `crowdStats`, apply `blendPoints`, then `crowdSubmit` (valid, non-repeat answers only). Depth += points x `POINTS_PER_METER`. Feedback: "Name · Tier · +N pts". Advance after 1100 ms.
- **Finish:** `recordDive`, `renderResults`, show results. The daily counts as complete **only now**.
- **Share:** copy/share `DEEPWELL <date> · <depth> m`, then a line of marks (`◈` for 70+ points, `◆` for a hit, `·` for a miss), then `https://deepwell.games`.
- **Buttons:** "Dive again" starts Endless (or the same pack). Escape returns home from non-game screens. First pointer-down wakes audio.
- **Boot:** load state, apply settings, build pack buttons, bind events, start the scene, render home, `await loadManifest()`, render home again, refresh the home screen every 60 s.

**Check:** `npm run serve`. Play a Daily Dive. Refresh in the middle of it and confirm the same prompts come back.

---

## STEP 11: `scripts/selftest.mjs`

Plain Node, no dependencies, exit code 1 on any failure. Assert: all catalog ids unique and well-formed; every Q-id in a pattern is registered; 400+ entries; `buildQuery` works for an item and a taxon entry; `parseBindings` drops unlabeled and duplicate names; pack round trip; `normalize` (accents, articles, `&`, `ø`); exact, alias, one-typo, nonsense, short-input and unique-surname matching; rarity (best about 3, rarest 100, monotonic, ties equal); tiers; crowd blend; letter options; seeded picks are deterministic, differ by seed and span 7 categories; every seed id exists in the catalog and has 8+ items.

**Check:** `npm test` prints "N passed, 0 failed".

---

## STEP 12: Data build and automation

**`scripts/build-data.mjs`** (Node 20+, global `fetch`):
1. Verify every Q-id in `ENTITY_LABELS` with `buildLabelQuery` in chunks of 80. A label that does not contain (or is not contained in) the expected one marks the id **bad**; entries using a bad id are skipped and logged.
2. For each remaining entry run `buildQuery`, `parseBindings`, and reject packs smaller than `minPool`. Write `data/packs/<id>.json` via `toPack`.
3. Send a `User-Agent` header, retry on 429/5xx (respect `Retry-After`), wait 1.5 s between queries.
4. Write `data/manifest.json` `{version, built, packs:{id:{n,built}}}` with `version` incremented each run.
5. Flags: `--only a,b,c`, `--resume` (skip packs under 6 days old), `--verify-only`, `--out`, `--manifest`. Exit 1 only if no pack at all was built.

**`.github/workflows/build-data.yml`**: triggers `workflow_dispatch` (optional `only` input passed through an **environment variable**, not inlined into the shell) and a weekly `cron: '17 3 * * 1'`; `permissions: contents: write`; steps: checkout, setup-node 22, `node scripts/selftest.mjs`, run the build, then commit and push `data/` only if it changed (git user `deepwell-bot`).

**Check:** `node scripts/build-data.mjs --verify-only` on a machine with internet; fix or remove any entry whose id it flags.

---

## STEP 13: Final test checklist (do all)

1. `npm test` passes.
2. Daily: the same 7 prompts after refresh; completing it blocks a second attempt and shows "Completed - N m".
3. A typo ("Vistla") shows the inline "Did you mean" box and the timer waits.
4. Famous answers score about 3 to 20, obscure ones 60 to 100.
5. Repeating an answer in one dive scores 0.
6. Works offline (seed lists only) with the badge "Offline list".
7. Phone width (F12 device mode): no sideways scroll, results readable.
8. Settings: Reduced motion stops the background movement; Color-safe changes the accent colors; text size changes.
9. Typing `<img src=x onerror=alert(1)>` as an answer shows as plain text on the results screen.
10. No errors in the browser console.

---

## STEP 14: Publish (also in Part 1 terms)

```bash
git add . && git commit -m "DEEPWELL v2"
git branch -M main
git remote add origin https://github.com/YOURUSERNAME/deepwell.git
git push -u origin main
```

1. GitHub repo > **Settings > Pages**: Deploy from a branch, `main`, `/ (root)`. Custom domain `deepwell.games`.
2. At your domain registrar add four **A** records for `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`, and a **CNAME** for `www` to `YOURUSERNAME.github.io`. Tick **Enforce HTTPS** when GitHub allows it (can take up to an hour).
3. **Settings > Actions > General > Workflow permissions: Read and write.** Then **Actions > Build question data > Run workflow** (30 to 60 minutes). It commits `data/packs/*.json`; run `git pull` locally afterwards.
4. Read the workflow log: it lists prompts skipped for bad ids or too few answers. Fix the catalog and rerun with `only`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Blank page on localhost | Use `npm run serve` or Live Server; modules fail from `file://` |
| "Failed to load module" | A file name or path is wrong; names are case-sensitive on GitHub |
| Workflow fails at self-test | Run `npm test` locally and fix the failure |
| Pack buttons say "Not enough questions" | That category has no data yet: run the data build, or the live query was blocked |
| Old version still showing | Hard refresh (Ctrl+Shift+R); Pages can take a minute |
| Daily differs between people | They are on different deployed versions or the data build ran between plays |

## Known limits

- Rarity is an estimate from Wikipedia coverage, not a count of real players, until the optional crowd backend (`docs/crowd-backend.md`) has collected enough answers.
- The Daily Dive is client-side. A determined player can look at the code or refresh mid-dive to retry the same prompts. A server is needed for a competitive leaderboard.
- Wikidata labels in English can occasionally be odd or incomplete; expect a few strange entries and fix them by raising `minSL` for that prompt in the catalog.
