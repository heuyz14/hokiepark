# HokiePark - architecture and work breakdown

Expands `HOKIEPARK_SPEC.md` and `HokiePark - 6-Hour Build Plan.md` into an implementable structure.
Current status lives in [STATE.md](STATE.md).

## 1. Shape of the system

```
 VT ArcGIS (public)            hand-authored demo data
       |                        (garage levels, lot permits/ADA)
       v  scripts/fetch-gis.ts          |
 data/raw/*.json  (committed, never re-fetched at runtime)
       |  scripts/build-data.ts         |
       v                                v
 src/data/*.json  ------------>  src/data/index.ts  =>  BUILDINGS, LOTS, GARAGES   (single source of truth)
                                        |
        +-------------------------------+---------------------------+
        v                               v                           v
  src/lib/* (pure logic, tested)   src/ui/* (DOM views)      src/lib/assistant.ts
  projection, viewport,            map, sheet, list,         (rule-based answers,
  occupancy, search, nearby        legend, badge, chat        same data + helpers)
        \_______________________________|___________________________/
                                        v
                    src/main.ts + src/state.ts  (wiring + tiny store)
                                        v
              scripts/build.ts (esbuild)  =>  dist/index.html  (+ manifest, sw.js, icons)
```

By default there is no backend and no database: the demo is client-side only (spec Section 11) with hand-set sample counts.
Optionally, garage counts come from a Supabase table (`docs/SUPABASE.md`): a read-only, RLS-protected `garage_levels` table polled
by `src/live.ts` and applied onto the same `GARAGES` array, so every view stays consistent. Unconfigured or offline, the bundled counts are used.

## 2. Key rules (why the code is shaped this way)

1. **One source of truth.** Every view reads `BUILDINGS`/`LOTS`/`GARAGES`. Every count printed anywhere goes through
   `lib/occupancy.ts` (`garageTotals`, `openSpaces`, `openAdaSpaces`, `availability`). A mismatch between map, list,
   sheet and assistant is therefore a display bug, never a data bug.
2. **Pure logic is separate from the DOM.** Anything with a formula (projection, zoom math, thresholds, place matching,
   answers) lives in `src/lib/` and has unit tests. `src/ui/` only renders.
3. **ADA is first-class.** One component (`ui/badge.ts`) renders the wheelchair badge in garage level rows, lot sheets, list
   rows, map markers and the legend. ADA blue (`--ada`) is deliberately distinct from residential blue.
4. **No VT network at runtime.** GIS data is fetched once into `data/raw/`; the app and its tests never call VT. The only
   optional runtime request is the read-only Supabase occupancy poll, and the app degrades to bundled counts if it is off or fails.
5. **Untrusted strings are escaped.** All dynamic text is interpolated through `esc()` in `ui/format.ts`.
6. **Honest demo data.** Invented data is labelled in code and in the UI ("Demo data - counts are simulated").

## 3. Modules

| Module | Responsibility | Tests |
| --- | --- | --- |
| `lib/projection.ts` | lat/lon -> meters (equirectangular), haversine, footprint -> SVG path | `projection.test.ts` (calibration vs great-circle) |
| `lib/viewport.ts` | pan/zoom/fly-to math on a viewBox, aspect fitting | `viewport.test.ts` |
| `lib/occupancy.ts` | open counts, totals, Open/Limited/Full thresholds, summaries | `occupancy.test.ts` (+ data invariants, edge cases) |
| `lib/search.ts` | case/punctuation-insensitive token substring match | `search.test.ts` |
| `lib/nearby.ts` | nearest items (footprint-edge distance), walk minutes, formatting | `search.test.ts` |
| `lib/occupancy-remote.ts` | fetch + strictly validate `garage_levels` rows, all-or-nothing apply onto `GARAGES` | `occupancy-remote.test.ts` |
| `lib/live-config.ts` | validate feed config; refuse service-role/secret keys | `live-config.test.ts` |
| `live.ts` / `ui/sync.ts` | poller (no overlap, backoff, pause when hidden) and the header status chip | `smoke:live` |
| `supabase/*` | migration (table, constraints, RLS, simulator), generated seed, optional cron | `seed.test.ts` |
| `lib/permits.ts` / `ui/permits.ts` | VT permit rules (lot classes, permit types, yes/no/check verdicts) and the map chip picker | `permits.test.ts`, `smoke` permit scenarios |
| `lib/assistant.ts` | intent + place resolution, deterministic answers, `Answerer` seam | `assistant.test.ts` (3 spec questions) |
| `data/*` | typed arrays; `garages.ts`/`lots.ts` hold the hand-set fields | `occupancy.test.ts`, `drillfield.test.ts` |
| `ui/map.ts` | SVG render, pointer pan/pinch, wheel zoom, fly-to, markers, selection highlight | `scripts/smoke.mjs` |
| `ui/sheet.ts` | bottom sheet: garage levels, lot, building + nearest parking | smoke |
| `ui/list.ts` | searchable list, selection sync with map | smoke |
| `ui/assistant.ts` | chat UI with loading/error states and "Show on map" refs | smoke |
| `state.ts` / `main.ts` | store (`view`, `selection`, `source`, `query`) and wiring | smoke |

**Selection flow.** Any view calls `select(sel, source, view?)`. The store notifies `main.ts`, which updates the sheet, the list
highlight and the map. Only non-map sources (`list`, `sheet`, `assistant`) trigger the fly-to animation; a map tap only nudges
the item out from under the sheet.

## 4. Extension points

- **LLM assistant:** implement `Answerer` (`(question) => Promise<Answer>`) and pass it to `createAssistant` in `main.ts`.
  The key must live in a serverless proxy, never in this bundle. Requires user approval (paid service).
- **Live occupancy:** implemented via Supabase (`docs/SUPABASE.md`). To use another source (e.g. Databricks behind an API), keep the
  `OccupancyRow` shape or adapt `fetchOccupancy`; `applyOccupancy` and every view stay unchanged.
- **Native iOS:** wrap `dist/` with Capacitor (needs Xcode + Apple ID). No code changes required.

## 5. Work breakdown (the plan's 4 lanes mapped to files)

| Lane (build plan) | Owns | Files |
| --- | --- | --- |
| Data/Map engineer (Phases 0-1) | GIS pull, projection, map render, pan/zoom, legend | `scripts/fetch-gis.ts`, `scripts/build-data.ts`, `lib/projection.ts`, `lib/viewport.ts`, `ui/map.ts`, `ui/legend.ts` |
| Feature engineer (Phase 2) | garages, lots, sheet, list, fly-to | `data/garages.ts`, `data/lots.ts`, `lib/occupancy.ts`, `lib/search.ts`, `lib/nearby.ts`, `ui/sheet.ts`, `ui/list.ts` |
| AI/polish engineer (Phases 3-4) | ADA badge, branding, assistant | `ui/badge.ts`, `styles.css`, `lib/assistant.ts`, `ui/assistant.ts`, `public/*` |
| PM/QA/design (Phases 5-6) | curate copy/colors, QA, rehearsal | `tests/`, `scripts/smoke.mjs`, `docs/STATE.md` |

## 6. Build and verify

```
npm install          # esbuild, typescript, @types/node (dev only)
npm run check        # typecheck + unit tests + build -> dist/index.html
npm run smoke -- 430 900   # end-to-end in system Chrome; also try 375 667 and 1280 800
npm run smoke:live         # same + mocked Supabase feed (live update, outage, bad payload, recovery)
npm run check:supabase     # verify a real Supabase project (reads .env.local, never prints the key)
npm run dev          # rebuild on change
```

Serve `dist/` over HTTPS (any static host) to install as a PWA on iPhone: Safari -> Share -> Add to Home Screen.
