# HokiePark

A mobile-first parking map and advisor for Virginia Tech's Blacksburg campus, built for **VTHacks 14** (Deloitte x Databricks
"Campus Life Intelligence Hub" track). Independent hackathon prototype, not an official Virginia Tech service.

**Live:** https://heuyz14.github.io/terraceb/ (installable on iPhone: Safari -> Share -> Add to Home Screen)

> **Honest about its data.** Occupancy is **simulated**, shaped by VT's public class timetable, because no real sensor feed exists.
> The forecast model is trained on that simulation, so its accuracy measures recovery of the simulation, not real-world accuracy.
> See [`docs/databricks/ML_FORECASTER.md`](docs/databricks/ML_FORECASTER.md).

## What it does
| | |
| --- | --- |
| **Map** | Real VT GIS footprints (102 buildings, 85 lots, 2 garages) on an OpenFreeMap basemap; garage counts by level; accessible (ADA) parking everywhere |
| **Permit filter** | "Set your permit" dims places you cannot use, from VT's 2026-27 Quick Guide rules; unknown signage is "check the sign", never a confident yes |
| **List** | Garages, lots and all buildings, searchable by name or official code (e.g. `TORG`) |
| **Plan** | Building + weekday + class time + permit -> top places with walk time and **forecast** fullness at arrival |
| **Ask** | A rule-based assistant, plus an optional AI advisor that picks tools and explains their results; every number comes from the app's own data and invented numbers are rejected |
| **Live counts** | Optional Supabase feed (read-only, polled), advanced every minute by a simulator |
| **Databricks** | Delta/Unity Catalog pipeline, Monte Carlo training data, MLflow-tracked model, batch-scored `predictions.json` |

## Quick start
Requires **Node >= 24** (it runs TypeScript directly; see `.nvmrc`).

```bash
npm ci
npm run dev            # rebuild dist/index.html on change
npm run check          # typecheck + unit tests + build
open dist/index.html   # the whole app is one self-contained file
```
With no configuration the app runs entirely on bundled sample data. To turn on the live feed and the advisor, copy `.env.example`
to `.env.local` and follow [`docs/operations/SUPABASE.md`](docs/operations/SUPABASE.md) and [`docs/advisor/ADVISOR.md`](docs/advisor/ADVISOR.md).

## Repository layout
```
src/                 the web app (TypeScript, bundled by esbuild into one HTML file)
  lib/               pure, unit-tested logic: permits, occupancy, planning, advisor, timetable, demand model
  ui/                DOM views: map, sheet, list, plan, chat, permit picker, legend
  data/              typed arrays (BUILDINGS / LOTS / GARAGES), generated GIS JSON, the Databricks forecast
tests/               unit tests (node:test)
scripts/
  build/             bundle the app, bundle the Edge Function, generate icons
  data/              pull VT data, regenerate src/data, seeds, curves and Databricks inputs
  verify/            end-to-end browser test, live checks of Supabase and the advisor
supabase/            migrations, generated seeds, optional cron, the `advisor` Edge Function
databricks/          notebooks 01-07, the Python model, its tests, the asset bundle
data/                raw/ (VT GIS + timetable pulls) and reference/ (hand-curated lookups)
docs/                architecture, operations (runbook, Supabase), advisor, databricks, product (spec)
public/  assets/     PWA manifest, service worker, icons
.github/workflows/   ci.yml (every push/PR) and pages.yml (manual deploy)
```

## Commands
| Command | What it does |
| --- | --- |
| `npm run dev` / `build` | rebuild on change / produce `dist/index.html` + PWA files |
| `npm run typecheck` / `test` / `check` | TypeScript / unit tests / all three plus build |
| `npm run smoke -- 430 900` | end-to-end run in system Chrome (also `375 667`, `1280 800`) |
| `npm run smoke:live` | same with a mocked Supabase feed and mocked advisor: updates, outage, bad payload, recovery, fallback |
| `npm run check:supabase` | verify your real Supabase project (never prints keys) |
| `npm run check:advisor` | ask the deployed advisor real questions through the real model |
| `npm run data` | re-flatten `data/raw/*.json` into `src/data/` |
| `npm run seed` / `curves` | regenerate `supabase/seed.sql` / `supabase/curves.seed.sql` |
| `npm run timetable` | one-time, polite pull of VT's public Timetable of Classes |
| `npm run advisor:build` | bundle the Edge Function into one pasteable `index.ts` |
| `npm run databricks:inputs` | export the files the Databricks notebooks upload |
| `npm run test:py` | Python model tests (parity with the TypeScript curves, simulator, ML) |

Generated files (`src/data/*.json`, `supabase/*.sql`, `supabase/functions/advisor/index.ts`, `databricks/data/*`) are checked by tests:
if one fails after you change its source, re-run the matching command above.

## Configuration
Build-time (public values only): `HOKIEPARK_SUPABASE_URL`, `HOKIEPARK_SUPABASE_ANON_KEY`, `HOKIEPARK_POLL_MS`, `HOKIEPARK_ADVISOR`,
`HOKIEPARK_ADVISOR_KEY`, `HOKIEPARK_ADVISOR_URL`. Function secrets (Supabase, never in the app): `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL`, `ALLOWED_ORIGINS`, `DAILY_LIMIT`, `PER_IP_LIMIT` (and optionally `GEMINI_API_KEY`, `GEMINI_MODEL`). See [`SECURITY.md`](SECURITY.md).

## Deploy
Manual and free: **Actions -> Deploy to Pages -> Run workflow** (needs the Actions variables above and Pages set to "GitHub Actions").
It only redeploys when you run it. Details: [`docs/operations/DEMO_RUNBOOK.md`](docs/operations/DEMO_RUNBOOK.md).

## Documentation
Start at [`docs/README.md`](docs/README.md). Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md). Security: [`SECURITY.md`](SECURITY.md).

## License
The code is released under the [MIT License](LICENSE). The data it displays is not covered by it: building and parking geometry and the class
timetable come from Virginia Tech's public services and remain subject to Virginia Tech's terms, and the permit rules paraphrase VT Parking
Services' published Quick Guide. "Virginia Tech" and "Hokies" are Virginia Tech marks; this project is not affiliated with or endorsed by the university.
