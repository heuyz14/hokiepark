# HokiePark - current state

_Last updated: 2026-09-19 ~13:40 (Phases 1-4 + PWA built and browser-verified via CDP smoke run; committed and pushed)._
Prompt log: [PROMPT_HISTORY.md](PROMPT_HISTORY.md). Source docs: `../HOKIEPARK_SPEC.md`, `../HokiePark - 6-Hour Build Plan.md`.

## What this is
HokiePark: mobile-first VT campus parking map for VTHacks 14 (Deloitte x Databricks track). Ships as ONE self-contained
`dist/index.html` (SVG map, `BUILDINGS`/`LOTS`/`GARAGES` arrays, phone-frame UI) plus PWA files next to it.
No backend, no database. (AGENTS.md's Supabase/Next.js stack is for the other repos, not this one.)

## Decisions (with why)
| Decision | Why |
| --- | --- |
| TypeScript source in `src/`, esbuild bundles to one HTML | Honors "single file" plan and AGENTS.md's TypeScript rule. Zero runtime deps. |
| Node built-in test runner, no Vitest | No extra dependency; Node 26 runs `.ts` directly. |
| esbuild postinstall NOT approved | Works without it (binary ships as platform package). |
| **Mobile target = PWA** (user go-ahead 2026-09-19) | iOS via Safari "Add to Home Screen" + web with one codebase. Xcode is NOT installed on this Mac; Capacitor deferred (needs ~10 GB Xcode, Apple ID, $99/yr for TestFlight). |
| **Assistant = rule-based, no LLM** | Artifact-platform AI sampling doesn't exist outside claude.ai; an LLM needs a paid backend proxy + API key (needs user approval). `Answerer` interface in `src/lib/assistant.ts` is the seam. |
| Assistant reads only the three data arrays via `lib/occupancy.ts` | Same numbers as map/list/sheet (Phase 5 requirement). |
| Nearest = distance to footprint vertex, not centroid | Centroids mislead for large multi-polygon lots. |

## Git workflow (standing instruction from user)
- Remote: `origin` = https://github.com/heuyz14/terraceb.git, branch `main`, upstream already set.
- Commit + push periodically (after each meaningful chunk). End commit messages with the Co-Authored-By line.
- Merge (not rebase) `origin/main` before pushing; on conflicts **keep the user's local code**.
- If push fails with HTTP 400 / "remote end hung up": `git -c http.postBuffer=524288000 push` (large raw GIS JSON exceeds the default 1 MB buffer).
- `dist/` and `node_modules/` are git-ignored. Never commit `.env` files.
- **Teammate prototype:** commit `1bb0f36` (Jnhim) added a separate Leaflet-based prototype at the repo root (`index.html`, `parking.js`, `data.js`, `distance.js`, `parking.css`, tests). Different approach (Leaflet tiles from unpkg, permit filter, demo scenarios, 5 approximate lots). Does NOT overlap this build's files (`src/`, `dist/`). Team should decide which is the demo, or merge ideas (their permit-eligibility filter is a good feature).

## Data
- Raw VT ArcGIS pulls in `data/raw/` (WGS84). Refetch: `node scripts/fetch-gis.ts`; flatten: `npm run data`.
- **102 buildings** (rule-based: 4 VT categories, existing, core-campus box, area >= 1000 sq ft, + Lane Stadium, Cassell). Spec says 92; its list isn't reproducible.
- 19 curated lots, 2 garages (Perry Street, North End Center) from GIS footprints.
- **Invented demo data (flag to team):** garage level counts (`src/data/garages.ts`); lot permit/ADA fields (`src/data/lots.ts`);
  5th ADA lot = **Stanger St. ADA** (spec names only four); Drillfield ellipse (`src/data/drillfield.ts`, VT has no polygon).

## Module map
```
scripts/  fetch-gis.ts (one-time pull) | build-data.ts (raw->src/data) | build.ts (bundle+PWA) | make-icons.py
public/   manifest.webmanifest | sw.js (cache stamped per build) | icons/
src/lib/  projection | viewport | occupancy | search | nearby | assistant      (pure, unit-tested)
src/data/ buildings | lots | garages | drillfield | index (BUILDINGS/LOTS/GARAGES)
src/ui/   map | sheet | list | legend | badge | assistant | format             (DOM)
src/      main.ts (wiring) | state.ts (tiny store) | styles.css | index.template.html
tests/    projection viewport occupancy search assistant drillfield           (33 tests)
```

## Progress vs. plan
| Phase | Status |
| --- | --- |
| 0 Setup & data | DONE |
| 1 Core map | DONE + browser-verified (pan, drag, wheel/button zoom, reset, fly-to). Polish in progress: label/marker collisions, fly-to zoom on large lots. |
| 2 Garages/lots/sheet/list | DONE + browser-verified (marker tap, sheet, list search/empty state, list<->map selection sync, keyboard Enter/Escape). |
| 3 ADA + branding | DONE (single `adaBadge` in 5 places; VT maroon/orange; ADA blue distinct from residential blue). Daylight contrast still to check in Phase 5. |
| 4 Assistant | DONE rule-based; 3 acceptance questions verified in unit tests AND in the browser; "Show on map" hand-off works. |
| PWA (added) | DONE + verified over http: manifest, service worker, precache, loads OFFLINE. Manifest link is injected only over http(s) so file:// stays console-clean. Not yet tested on a real iPhone (needs HTTPS host). |
| 5 QA pass | Partly: smoke covers core flows at 3 viewports. Still to do: contrast check, explicit cross-view number audit (marker/list/sheet/assistant). |
| 6 Rehearsal | Not started (needs team + real machine) |

## Verified so far
- `npm run check`: `tsc --noEmit` clean, **33/33 tests pass**, build OK (`dist/index.html` ~322 KB).
- `npm run build && npm run smoke -- <w> <h>` (CDP end-to-end, system Chrome, no deps): ALL PASS at 430x900, 375x667 and 1280x800; zero console errors; no horizontal overflow. (Note: in zsh pass width/height as literal args, not via a `$var` loop.)
- Bug found by the 375x667 run and fixed: the bottom-sheet header scrolled away, hiding the close button on small screens; header is now sticky.
- Not verified: real iOS Safari, contrast in sunlight.

## Work log
- 12:29-12:45 Read spec+plan; confirmed VT ArcGIS reachable; saved raw data; wrote flatten script; spot-checked landmarks.
- 12:45-13:00 Libs + tests (projection/viewport/occupancy/search/nearby/Drillfield); map, sheet, list, badge, legend, CSS, build script.
- 13:40-14:00 Turned the driver into `scripts/smoke.mjs` (`npm run smoke`); found + fixed sticky-sheet-header bug at small sizes; label/fly-to polish.
- 13:15-13:40 CDP smoke run (27 checks pass, zero console errors), PWA verified over http incl. offline; fixed chip overflow + manifest-on-file:// error; first commits + merge with teammate prototype + push.
- 13:00-13:15 Screenshot review + fixes; PWA files + icons; assistant logic (found+fixed 2 bugs: "life" false place match, centroid-distance ranking); chat UI.

## Remaining work and estimate (~2.5-3 h of my time, plus user-only steps)
| Item | Est. |
| --- | --- |
| ~~Browser verification (CDP smoke driver)~~ done: 27/27 checks + PWA/offline pass on phone width; polish findings below | done |
| ~~Polish: label offset, fly-to zoom~~ applied; needs a visual re-check | 10 min |
| `docs/ARCHITECTURE.md` + README + task split | 20 min |
| Phase 5 QA: cross-view number consistency check, edge cases, phone + desktop widths, contrast | 30-40 min |
| ~~E2E script~~ done: `scripts/smoke.mjs` | done |
| Polish from QA (label density, marker overlap, Drillfield tune) | 30 min |
| **User-only:** choose host + deploy over HTTPS (Vercel/Netlify/GitHub Pages), test on a real iPhone | 15-30 min |
| **Team-only:** Phase 6 rehearsal x2, fallback screenshots on the demo machine, confirm ADA lot + demo numbers | 15-30 min |

## Open questions / needs from the user
- Hosting choice for the HTTPS deploy (needed for iPhone install + service worker). Nothing to do until I finish QA.
- Teammate to confirm the 5th ADA lot and demo garage numbers (spec header asks for team confirmation).
- Optional later: LLM-backed assistant (needs API key + proxy) and Capacitor/Xcode wrapper.

## Commands
`npm run data` | `npm run build` | `npm run dev` (watch) | `npm test` | `npm run typecheck` | `npm run check` (all three)
