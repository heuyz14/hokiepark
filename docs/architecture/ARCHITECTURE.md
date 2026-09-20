# HokiePark - architecture

How the system fits together and why it is shaped this way. Product intent lives in [`../product/SPEC.md`](../product/SPEC.md);
current status and decisions live in [`../STATE.md`](../STATE.md).

## 1. System overview

```
 VT public data                      class schedule signal                    Databricks (Free Edition)
 ArcGIS (buildings, lots)            Timetable of Classes (Banner)            notebooks 01-07: Delta / Unity Catalog / MLflow
        |  scripts/data/fetch-gis          |  scripts/data/fetch-timetable          ^ uploads 5 input files
        v                                  v                                        |  npm run databricks:inputs
 data/raw/*.json (committed, never fetched at runtime)                              v
        |  scripts/data/build-data      |  gen-curves                  out/predictions.json  ->  src/data/predictions.json
        v                               v
 src/data/*.json ----> BUILDINGS/LOTS/GARAGES        supabase/curves.seed.sql --> Supabase: garage_levels, garage_level_curves
        |                                                   pg_cron tick every minute steers counts toward the curve
        v                                                                   |  read-only, polled every 60 s
   src/lib (pure logic)  <---------------------- src/live.ts <--------------+
   src/ui  (DOM views)                                                       
        |                                                                    
   src/main.ts + state.ts  -->  scripts/build/build.ts (esbuild)  -->  dist/index.html (+ manifest, sw.js, icons)  -->  GitHub Pages

 Ask tab (optional advisor):  browser agent loop --POST {contents, context}--> Supabase Edge Function `advisor` --> OpenRouter (or Gemini)
                              tools run IN THE BROWSER on the app's own data; the function only relays one model turn
```
By default there is no backend: the app runs on bundled sample data. Each backend piece (live feed, advisor) is optional and the app degrades
to the bundled data and the rule-based assistant if it is off or fails.

## 2. Rules the code is shaped around
1. **One source of truth.** Every view reads `BUILDINGS`/`LOTS`/`GARAGES`. Counts go through `lib/occupancy.ts`, so map, list, sheet, assistant and advisor cannot disagree.
2. **Pure logic is separate from the DOM.** Formulas, matching, permit rules, planning and the advisor's tools live in `src/lib/` with unit tests; `src/ui/` only renders.
3. **Permits are never guessed.** `lib/permits.ts` returns `yes | no | check`; everything that recommends a place (Plan, advisor) only recommends `yes`, lists `check` separately, and never shows `no`.
4. **The AI never supplies facts.** The advisor picks tools and phrases their results; a guard rejects any number that no tool returned and any place a tool did not return; any failure falls back to the rule-based assistant.
5. **Simulated data is labelled everywhere** (UI text, JSON `kind: "SIMULATED"`, MLflow tags, docs).
6. **No VT network at runtime.** VT data is pulled once into `data/raw/`; the app and its tests never call VT.
7. **Secrets stay server-side.** Only the Supabase URL and public keys are baked into the bundle; the build refuses a service-role or secret key.
8. **Untrusted strings are escaped** through `esc()` (`ui/format.ts`).

## 3. Modules
**`src/lib` (pure, tested)**
| Module | Responsibility |
| --- | --- |
| `occupancy.ts`, `occupancy-remote.ts`, `live-config.ts`, `sync-label.ts`, `seed-drift.ts` | counts and thresholds; fetch + strictly validate + apply live rows; feed config guard; header-chip text and staleness; DB-vs-app drift |
| `permits.ts` | VT permit rules: lot classes, permit types, verdicts with reasons |
| `search.ts`, `nearby.ts`, `geojson.ts` | name/code search; footprint-edge distance and walk minutes; footprints to GeoJSON for the map |
| `assistant.ts` | rule-based intents, place resolution, deterministic answers, the `Answerer` seam |
| `planahead.ts`, `planask.ts` | forecast lookup and ranking (Plan tab); time/day parsing and plan answers in Ask |
| `advisor-spec.ts`, `advisor-tools.ts`, `advisor.ts`, `advisor-config.ts` | tool/prompt contract shared with the Edge Function; the 7 deterministic tools; agent loop + guards; build-time config |
| `timetable.ts`, `demand.ts`, `seed-sql.ts`, `curves-sql.ts` | parse VT's timetable; class-activity occupancy curves; SQL renderers for the generated seeds |

**`src/ui` (DOM):** `map.ts` (MapLibre GL, building/lot/garage layers, markers, permit highlight), `sheet.ts`, `list.ts`, `plan.ts`, `assistant.ts` (chat), `permits.ts`, `legend.ts`, `badge.ts`, `sync.ts`, `format.ts`.
**`src/data`:** typed arrays plus generated GIS JSON (`buildings.json`, `*.geo.json`), hand-set demo fields (`garages.ts`, `lots.ts`), and `predictions.json` (Databricks output).
**`supabase/`:** migrations (tables, RLS, constraints, simulator), generated seeds, optional cron, and `functions/advisor` (`handler.ts` request handling, `providers.ts` OpenRouter/Gemini, `main.ts` Deno entry, `index.ts` generated single-file bundle).
**`databricks/`:** notebooks `01`-`07`, the Python model (`hokiepark_demand/sim/ml.py`, tested for exact parity with the TypeScript curves), `databricks.yml`.

## 4. Data lineage (real vs assumed vs generated)
See [`../databricks/ML_FORECASTER.md`](../databricks/ML_FORECASTER.md) for the full table. In short: geography, timetable and permit rules are real; lot capacities are derived from GIS area;
driver behaviour is an assumed, randomised model; occupancy labels are generated; there is no measured occupancy.

## 5. Security model
Public values only in the bundle. Supabase tables are read-only for the anon key (RLS + revoked write grants); the curves and config tables are private. The advisor key is a function secret; the function
validates every request, injects the system prompt and tool declarations itself, allow-lists origins, rate-limits per visitor and per day, and never echoes upstream bodies or keys. Details: [`../../SECURITY.md`](../../SECURITY.md).

## 6. Extension points
- **Another occupancy source** (real sensors, Databricks behind an API): keep the `OccupancyRow` shape or adapt `fetchOccupancy`; every view is unchanged.
- **Another model provider:** add a function in `supabase/functions/advisor/providers.ts`; the client, tools and guards do not change.
- **Real occupancy history:** replace notebook 05's simulated labels with measured ones; notebooks 06-07 become a real forecast evaluation.
- **Native iOS:** wrap `dist/` with Capacitor (needs Xcode).

## 7. Build and verify
`npm run check` (typecheck + unit tests + build); `npm run smoke` and `npm run smoke:live` (browser); `npm run test:py` (model). CI runs the first and last on every push and pull request (`.github/workflows/ci.yml`).
