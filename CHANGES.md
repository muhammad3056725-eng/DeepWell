# DEEPWELL mobile performance fix — 2026-11-22

## Files changed in this performance patch
- `js/scene.js` — added cached high-quality water layers, removed the remaining active `shadowBlur` reset, replaced a per-frame water colour `map()` allocation with a fixed loop, and made the water-cache fallback flat-fill so cache misses cannot recreate a per-frame gradient.
- `CHANGES.md` — records the implementation and verification status.

## Implemented from the mobile-performance brief

- High / Medium / Low graphics tiers remain available.
- Touch/small-screen rendering uses reduced DPR and lower creature counts; Low is capped at 30 FPS.
- Auto quality can step down after a 2-second performance sample.
- Hidden tabs stop the animation loop.
- The high-quality water base/halo/haze layers are pre-rendered into 8 depth slices and reused with `drawImage`.
- The Low tier uses flat-fill scene rendering rather than the expensive high-quality gradient stack.
- The existing `?perf` overlay reports FPS, frame time, tier, and creature count.
- The existing timer/settings/CSS performance changes already present on `main` remain untouched by this patch.
- Game logic, scoring, prompts, data, and question matching were not changed.

## Before / after implementation numbers

These are code-level counts, not fabricated device measurements:

| Metric | Before | After |
|---|---:|---:|
| Cached water depth slices | 0 | 8 |
| Water base/halo/haze gradient construction per frame | 1 stack | 0 on cache hit |
| Low-tier FPS cap | 30 FPS | 30 FPS |
| Low-tier DPR cap | 1.0 | 1.0 |
| High-tier water cache fallback | Per-frame gradient | Flat fill |
| Per-frame water palette array allocation | 1 `map()` result | 0 |

## Verification

- GitHub Actions **Validate DEEPWELL**: passed after the final code fix.
- GitHub Actions **Data pipeline tests**: passed after the final code fix.
- The previous CI failure was a syntax error in `js/data.js`; that file was subsequently restored to `main` because the brief explicitly prohibits changing data/logic files.
- A real Pixel 5 / Chrome DevTools 4× and 6× CPU-throttled 10-second Performance profile was **not available in this environment**, so no FPS/frame-time measurements are claimed.
- Paint-flashing/Layers screenshots and real-device visual checks were also not available here and should be checked on a phone before calling the performance target fully verified.

## Remaining manual verification required by the brief

1. Pixel 5 or similar Chrome DevTools device mode at 4× and 6× CPU throttling.
2. 10-second dive profile and 10-second giant-fish profile at each throttle level.
3. Record average frame time and longest frame before/after.
4. Check Paint flashing and Layers for large per-frame repaints/layout.
5. Run `?perf` and confirm automatic downgrade under throttling.
6. Compare desktop High vs phone Low screenshots.
7. Confirm Reduced motion, Color-safe, giant-fish, scoring/results, and Daily Dive behavior.
