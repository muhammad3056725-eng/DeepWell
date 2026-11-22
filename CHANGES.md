# DEEPWELL visual overhaul

## Files changed
- `index.html` — added the live depth-zone label and a four-band descent gauge; bumped the page and stylesheet cache keys.
- `css/style.css` — added zone-reactive accent colours, distinct Daily/Endless/Packs button gradients, a glass HUD, the depth gauge, results reveals, and predator-encounter focus styling.
- `js/scene.js` — expanded the Canvas 2D renderer with a golden-hour surface and moving waterline, smoothly blended sunlight/twilight/midnight/abyss palettes, layer-aware light, 8 ambient creature forms, marine snow, jellyfish and distant abyssal silhouettes. Added a player submersible with a depth-responsive lamp and a 6-species hinged-jaw predator encounter with random colours, sizes, approach direction, height and captions. Added reduced-motion handling, tab-visibility pause, and a low-frame-rate quality fallback.
- `js/audio.js` — added synthesized gulp and rare-answer sparkle effects tied to the existing Sound slider.
- `js/main.js` — connected Settings toggles to the scene and changed only timer-bar colour presentation; scoring, answer checks, dive progression and data calls are unchanged.
- `js/ui.js` — added the four-zone label and updates the gauge marker from the real depth.
