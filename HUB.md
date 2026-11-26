# deepwell.games hub — note for whoever maintains the Deepwell game

deepwell.games root is no longer the game itself. It is a clean
game-selection interface: four cards (Deepwell + NEXUS RELAY +
HYPE RIOT + LUMEN VAULT) over a code-drawn pixel-space background
(`hub-bg.svg`). No advertising poster is used. A visitor picks a
card and is sent to that game.

Note on theme: Deepwell (in-game title APOGEE) is a SPACE flight
trivia game — the rarer your answer, the higher you fly. Its poster
art is ocean-styled, but the game itself is space (owner
correction, Nov 26, 2026). Do not describe or theme it as a
sea/ocean game.

## Four games, four repositories

- This repo (`muhammad3056725-eng/DeepWell`) serves the domain: the
  hub at the root, plus the Deepwell game.
- `muhammad3056725-eng/Nexus-Relay` serves NEXUS RELAY from its own
  GitHub Pages: https://muhammad3056725-eng.github.io/Nexus-Relay/
  (or https://nexus.deepwell.games/ if that subdomain is set up).
- `muhammad3056725-eng/Hype-Riot` serves HYPE RIOT from its own
  GitHub Pages: https://muhammad3056725-eng.github.io/Hype-Riot/
- `muhammad3056725-eng/Lumen-Vault` serves LUMEN VAULT from its own
  GitHub Pages: https://muhammad3056725-eng.github.io/Lumen-vault/
  (the served path is `/Lumen-vault/` — lowercase "vault"; the
  capital-V form 404s, so keep the casing exact).
- The hub only links out to each game's own URL. The games are NOT
  merged or copied into one repo.

## How each game is reached

- Deepwell card → https://deepwell.games/deepwell/
- NEXUS RELAY card → https://muhammad3056725-eng.github.io/Nexus-Relay/
- HYPE RIOT card → https://muhammad3056725-eng.github.io/Hype-Riot/
- LUMEN VAULT card → https://muhammad3056725-eng.github.io/Lumen-vault/
- Link targets live in ONE `GAME_URLS` block in the hub's
  `index.html`; keep the card anchor `href`s in sync with it.

## Workflow arrangement (all game repos)

Each game repo deploys via GitHub Actions (`.github/workflows/
pages.yml`, source = GitHub Actions in the repo's Pages settings).
Per the standing rule below, each game also has a Wikidata
dataset-build workflow (Nexus: `dataset-expansion.yml`; Hype Riot:
`data-build.yml`, weekly; Lumen Vault: `data-build.yml`, monthly,
plus `daily-vault.yml` generating the Daily Grand Vault). The Muse
GitHub App cannot push `.github/workflows/` files (no Workflows
permission), so the owner pastes those files into each repo
himself; everything else is pushed by the app.

HYPE RIOT party mode: the relay code is written
(`packages/party-worker/` in the Hype-Riot repo, a Cloudflare
Durable Objects WebSocket relay) but NOT deployed. The in-game
Party Room stays gated until a relay URL is deployed and built in
via `VITE_PARTY_WS_URL`. Solo modes are fully live without it.

## What this repo must keep stable

- `deepwell/index.html` — the game's entry point (a copy of the
  game's page with `<base href="/">`). Do not remove or rename it.
- The game's asset folders `css/`, `js/`, `data/`, `theme/` must stay
  at the repo root with their current paths: the `/deepwell/` page
  resolves its assets against the root. Do not rename or move them
  without updating this hub setup.

## The game itself is not modified

No Deepwell game file was changed or deleted for this setup. Only
four files were added: `index.html`, `styles.css` and `hub-bg.svg`
(the pixel-space background) at the repo root (the hub) and
`deepwell/index.html` (the entry point).

## Status (Nov 26, 2026)

All four games are live and verified end-to-end from this hub:
APOGEE (Deepwell: broad everyday + knowledge prompts, answers
stored once), NEXUS RELAY (rebuilt Nov 27 as a catch-the-clues
multiple-choice game, 682 curated mysteries), HYPE RIOT (high-end
arena, 122 shows; party relay written, not deployed) and LUMEN
VAULT (64 proved chambers in 8 wings). Each card on the hub was followed through to its
game and the game's data files checked live.

## Standing rule: every game ships a Wikidata dataset build

Owner standing rule (Nov 26, 2026): every game in this hub ships
with a dataset-build workflow whose data is sourced and grown from
Wikidata. The workflow rebuilds the game's dataset, validates it
with the game's tests, publishes versioned dataset releases, and
reports the real counts from each run (no inflated numbers).

NEXUS RELAY, HYPE RIOT and LUMEN VAULT are all being built to this
rule. Deepwell is expected to mirror it: whoever maintains the
Deepwell game should give it the same Wikidata dataset build —
sourced/grown from Wikidata, rebuilt and validated by tests,
released as versioned datasets, with real counts reported per run.

Note: `.github/workflows/` files cannot be pushed by the Muse
GitHub App (it lacks the Workflows permission), so each game's
workflow file is pasted into its repo by the owner. If Deepwell
gets a dataset-build workflow, expect the owner to paste the file
in the same way.
