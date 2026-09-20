# Scripts

All are run through `npm run <name>` (see the root README); run from the repo root.

| Folder | Script | npm script | Purpose |
| --- | --- | --- | --- |
| `build/` | `build.ts` | `build`, `dev` | Bundle `src/` into one self-contained `dist/index.html` (+ PWA files); bakes in public config only |
| `build/` | `build-advisor.ts` | `advisor:build` | Bundle the Supabase Edge Function into the single pasteable `supabase/functions/advisor/index.ts` |
| `build/` | `make-icons.py` | - | Regenerate PWA icons from `assets/icon-master.png` (needs Pillow) |
| `data/` | `fetch-gis.ts` | - | One-time pull of VT's public ArcGIS layers into `data/raw/` (network) |
| `data/` | `fetch-timetable.ts` | `timetable` | One-time, polite pull of VT's Timetable of Classes into `data/raw/timetable.json` (network) |
| `data/` | `build-data.ts` | `data` | Flatten `data/raw/*.json` into `src/data/*.json` (no network) |
| `data/` | `gen-seed.ts` | `seed` | Write `supabase/seed.sql` from `src/data/garages.ts` |
| `data/` | `gen-curves.ts` | `curves` | Write `supabase/curves.seed.sql` from the timetable and the demand model |
| `data/` | `export-databricks-inputs.ts` | `databricks:inputs` | Write `databricks/data/*` and refresh the git-ignored `databricks/upload/` |
| `verify/` | `smoke.mjs` | `smoke`, `smoke:live` | End-to-end browser test over the Chrome DevTools Protocol (no extra dependencies) |
| `verify/` | `check-supabase.ts` | `check:supabase` | Verify your real Supabase project (never prints keys) |
| `verify/` | `check-advisor.ts` | `check:advisor` | Ask the deployed advisor real questions through the real model |

Scripts that generate files write deterministic output, and tests fail if a committed generated file is stale.
