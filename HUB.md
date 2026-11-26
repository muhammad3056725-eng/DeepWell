# deepwell.games hub — note for whoever maintains the Deepwell game

deepwell.games root is no longer the game itself. It is a clean
game-selection interface: two cards (Deepwell + NEXUS RELAY), no
poster, no images. A visitor picks a card and is sent to that game.

## Two games, two repositories

- This repo (`muhammad3056725-eng/DeepWell`) serves the domain: the
  hub at the root, plus the Deepwell game.
- `muhammad3056725-eng/Nexus-Relay` serves NEXUS RELAY from its own
  GitHub Pages: https://muhammad3056725-eng.github.io/Nexus-Relay/
  (or https://nexus.deepwell.games/ if that subdomain is set up).
- The hub only links out to each game's own URL. The games are NOT
  merged or copied into one repo.

## How each game is reached

- Deepwell card → https://deepwell.games/deepwell/
- NEXUS RELAY card → https://muhammad3056725-eng.github.io/Nexus-Relay/
- Link targets live in ONE `GAME_URLS` block in the hub's
  `index.html`; keep the card anchor `href`s in sync with it.

## What this repo must keep stable

- `deepwell/index.html` — the game's entry point (a copy of the
  game's page with `<base href="/">`). Do not remove or rename it.
- The game's asset folders `css/`, `js/`, `data/`, `theme/` must stay
  at the repo root with their current paths: the `/deepwell/` page
  resolves its assets against the root. Do not rename or move them
  without updating this hub setup.

## The game itself is not modified

No Deepwell game file was changed or deleted for this setup. Only
three files were added: `index.html` and `styles.css` at the repo
root (the hub) and `deepwell/index.html` (the entry point).

## Status (Nov 26, 2026)

Hub and Deepwell are live and verified. The NEXUS RELAY card is
wired, but the Nexus-Relay repo push is still pending: it awaits the
owner adding Nexus-Relay to the Muse GitHub App's repository
access.
