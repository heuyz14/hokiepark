# HokiePark - current state

_Last updated: 2026-09-19 ~13:15 (Phases 1-4 built as code; PWA scaffolding added; awaiting browser verification)._
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
| 1 Core map | Built. One headless screenshot reviewed earlier; fixes since (legend to bottom strip, edge padding, label collisions, Drillfield refit) not yet re-screenshotted. |
| 2 Garages/lots/sheet/list | Built (sheet for garage/lot/building + nearest parking, searchable list, fly-to both ways). Not yet exercised in a browser. |
| 3 ADA + branding | Built (single `adaBadge` component in 5 places; VT maroon/orange; ADA blue distinct). Daylight contrast not checked. |
| 4 Assistant | Built rule-based; 3 acceptance questions covered by unit tests with data-derived expected numbers. UI untested in browser. |
| PWA (added) | Manifest, icons, service worker, iOS meta, safe-area + no-zoom-on-focus CSS done. SW only registers over http(s); not testable from `file://`. |
| 5 QA pass | Not started |
| 6 Rehearsal | Not started (needs team + real machine) |

## Verified so far
- `npm run check`: `tsc --noEmit` clean, **33/33 tests pass**, build OK (`dist/index.html` ~322 KB).
- NOT verified: any browser interaction, console errors, iOS Safari, service worker behavior, phone-width layout after fixes.

## Work log
- 12:29-12:45 Read spec+plan; confirmed VT ArcGIS reachable; saved raw data; wrote flatten script; spot-checked landmarks.
- 12:45-13:00 Libs + tests (projection/viewport/occupancy/search/nearby/Drillfield); map, sheet, list, badge, legend, CSS, build script.
- 13:00-13:15 Screenshot review + fixes; PWA files + icons; assistant logic (found+fixed 2 bugs: "life" false place match, centroid-distance ranking); chat UI.

## Remaining work and estimate (~2.5-3 h of my time, plus user-only steps)
| Item | Est. |
| --- | --- |
| Browser verification (CDP smoke driver) + fix findings | 30-45 min |
| `docs/ARCHITECTURE.md` + README + task split | 20 min |
| Phase 5 QA: cross-view number consistency check, edge cases, phone + desktop widths, contrast | 30-40 min |
| Playwright-free E2E of critical flows (or keep CDP script in `scripts/`) | 20 min |
| Polish from QA (label density, marker overlap, Drillfield tune) | 30 min |
| **User-only:** choose host + deploy over HTTPS (Vercel/Netlify/GitHub Pages), test on a real iPhone | 15-30 min |
| **Team-only:** Phase 6 rehearsal x2, fallback screenshots on the demo machine, confirm ADA lot + demo numbers | 15-30 min |

## Open questions / needs from the user
- Hosting choice for the HTTPS deploy (needed for iPhone install + service worker). Nothing to do until I finish QA.
- Teammate to confirm the 5th ADA lot and demo garage numbers (spec header asks for team confirmation).
- Optional later: LLM-backed assistant (needs API key + proxy) and Capacitor/Xcode wrapper.

## Commands
`npm run data` | `npm run build` | `npm run dev` (watch) | `npm test` | `npm run typecheck` | `npm run check` (all three)
