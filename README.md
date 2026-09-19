# HokiePark

VTHacks 14 (Deloitte x Databricks "Campus Life Intelligence Hub" track): a mobile-first parking map for Virginia Tech's
Blacksburg campus. Real building and lot geometry from VT's public GIS, level-by-level garage counts, first-class
accessible (ADA) parking, and a plain-English parking assistant. Availability is **simulated demo data**.

## Run it

```bash
npm install
npm run build            # -> dist/index.html (one self-contained file) + PWA files
open dist/index.html     # or serve dist/ over HTTPS to install on a phone
```

On iPhone: host `dist/` over HTTPS, open in Safari, Share -> Add to Home Screen. It works offline once loaded.

## Live garage counts (optional Supabase feed)

Without configuration the app shows bundled sample counts. To make counts come from a database you can change live
(and update every view within ~15 s), follow [`docs/SUPABASE.md`](docs/SUPABASE.md): create a Supabase project, run the
migration + seed, put the public URL and anon key in `.env.local`, then `npm run check:supabase` and `npm run build`.

## Develop

| Command | What it does |
| --- | --- |
| `npm run dev` | rebuild on change |
| `npm run check` | typecheck + unit tests + build |
| `npm run smoke -- 430 900` | end-to-end run in system Chrome (also `375 667`, `1280 800`) |
| `npm run smoke:live` | same, plus a mocked Supabase feed: live updates, outage, bad payload, recovery |
| `npm run check:supabase` | verify your real Supabase project (reads `.env.local`, never prints the key) |
| `npm run seed` | regenerate `supabase/seed.sql` from `src/data/garages.ts` |
| `npm run data` | re-flatten `data/raw/*.json` into `src/data/` |
| `node scripts/fetch-gis.ts` | re-pull VT GIS data (one-time; never called at runtime) |

## Docs

- [`docs/STATE.md`](docs/STATE.md) - current status, decisions, remaining work and estimates
- [`docs/SUPABASE.md`](docs/SUPABASE.md) - live occupancy setup, security model, tests
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - module map, rules, extension points, work split
- [`docs/PROMPT_HISTORY.md`](docs/PROMPT_HISTORY.md) - log of requests
- [`HOKIEPARK_SPEC.md`](HOKIEPARK_SPEC.md), [`HokiePark - 6-Hour Build Plan.md`](HokiePark%20-%206-Hour%20Build%20Plan.md)

Independent hackathon prototype, not an official Virginia Tech service.
