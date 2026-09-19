# HokiePark - current state

_Last updated: 2026-09-19 ~15:40 (Phases 1-5 done; Supabase live feed verified against the REAL project; next: deploy + iPhone test + rehearsal)._
Prompt log: [PROMPT_HISTORY.md](PROMPT_HISTORY.md). Source docs: `../HOKIEPARK_SPEC.md`, `../HokiePark - 6-Hour Build Plan.md`.

## What this is
HokiePark: mobile-first VT campus parking map for VTHacks 14 (Deloitte x Databricks track). Ships as ONE self-contained
`dist/index.html` (SVG map, `BUILDINGS`/`LOTS`/`GARAGES` arrays, phone-frame UI) plus PWA files next to it.
No backend required: by default it uses bundled sample counts. **Optional Supabase feed** (built, see `docs/SUPABASE.md`) makes garage counts live.
(AGENTS.md's Next.js stack is for the other repos; only its Supabase/RLS/security rules are applied here.)

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
| **Live occupancy = Supabase table, polled** (user go-ahead) | Live counts need a store someone can write to. Read-only for the browser via RLS; zero-dependency `fetch` client (no supabase-js); polling not Realtime (enough for a demo). |
| Feed is optional and degrades to bundled counts | Unconfigured/offline/outage never breaks the demo; header chip shows the state. |
| Only public URL + anon key embedded; build refuses service_role/secret | AGENTS.md: never expose service-role keys to the browser. Tested. |
| Hand-written response validator instead of Zod | Keeps zero runtime deps; every field range-checked; all-or-nothing apply. |

## Git workflow (standing instruction from user)
- Remote: `origin` = https://github.com/heuyz14/terraceb.git, branch `main`, upstream already set.
- Commit + push periodically (after each meaningful chunk). End commit messages with the Co-Authored-By line.
- **Identity:** every repo under `~/ProjectPort` commits as `heuyz14 <heuyz14@yahoo.com>` (the identity `laelaps` and `nqmate` already used). It comes from a folder rule in `~/.gitconfig` (`includeIf "gitdir:/Users/bubba/ProjectPort/"` -> `~/.gitconfig-projectport`); the global default `hle142025S <heuyz48@gmail.com>` still applies outside the folder, and a backup is at `~/.gitconfig.bak-before-projectport`. Pushes authenticate as heuyz14 via the macOS Keychain (HTTPS). Commits before 2026-09-19 ~16:00 are authored as `hle142025S` and were not rewritten (that needs a force-push on a shared branch); a few commits after that used the equivalent no-reply address `204778464+heuyz14@users.noreply.github.com`, which GitHub also credits to heuyz14.
- Merge (not rebase) `origin/main` before pushing; on conflicts **keep the user's local code**.
- If push fails with HTTP 400 / "remote end hung up": `git -c http.postBuffer=524288000 push` (large raw GIS JSON exceeds the default 1 MB buffer).
- `dist/` and `node_modules/` are git-ignored. Never commit `.env` files.
- **Teammate prototype:** commit `1bb0f36` (Jnhim) added a separate Leaflet-based prototype at the repo root (`index.html`, `parking.js`, `data.js`, `distance.js`, `parking.css`, tests). Different approach (Leaflet tiles from unpkg, permit filter, demo scenarios, 5 approximate lots). Does NOT overlap this build's files (`src/`, `dist/`). **Update:** the teammate deleted those files upstream in `f35285e` (7 "Delete ..." commits); merged cleanly. Their permit-eligibility filter idea remains a good candidate feature.

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
| Supabase live feed (added) | Built + tested: migration (RLS read-only, constraints, simulator), generated seed, poller with backoff/pause, header chip, in-place refresh of map/list/sheet, key guard, `check:supabase`. Verified against a MOCK (`smoke:live`: update, open-sheet update + scroll kept, outage, bad payload, recovery, audit). **Verified against the real project (2026-09-19):** `check:supabase` passes (9 valid rows, both garages, anon key cannot write -> HTTP 401); headless render shows chip `Live` and marker numbers equal the DB rows. Not yet seen: a live change during a session (needs the simulator run from the SQL editor). |
| PWA (added) | DONE + verified over http: manifest, service worker, precache, loads OFFLINE. Manifest link is injected only over http(s) so file:// stays console-clean. Not yet tested on a real iPhone (needs HTTPS host). |
| 5 QA pass | DONE for what can be automated: smoke at 3 viewports, cross-view number audit (marker = list = sheet = level sum = assistant, both garages), WCAG AA contrast tests (11 pairs), edge cases (full level, 0 ADA, no-match search). Remaining: a human pass on a real phone. |
| 6 Rehearsal | Not started (needs team + real machine) |

## Verified so far
- `npm run check`: `tsc --noEmit` clean, **64/64 tests pass** (incl. contrast, remote validation, key guard, seed sync)
- `npm run smoke:live` ALL PASS at 430x900, 375x667, 1280x800 (mock Supabase; fake key)., build OK (`dist/index.html` ~322 KB).
- `npm run build && npm run smoke -- <w> <h>` (CDP end-to-end, system Chrome, no deps): ALL PASS at 430x900, 375x667 and 1280x800; zero console errors; no horizontal overflow. (Note: in zsh pass width/height as literal args, not via a `$var` loop.)
- Bug found by the 375x667 run and fixed: the bottom-sheet header scrolled away, hiding the close button on small screens; header is now sticky.
- Not verified: real iOS Safari, contrast in sunlight.

## Connecting a real Supabase project (DONE for local builds; step 5 still open)
1. Create a free Supabase project. 2. SQL editor: run `supabase/migrations/20260919000000_garage_levels.sql`, then `supabase/seed.sql`.
3. Copy the **Project URL** and **anon/publishable** key (NOT service_role) into `.env.local` (copy of `.env.example`).
4. `npm run check:supabase` (tell me the result; it never prints the key), then `npm run build` -> "live feed: ON".
5. For the deployed site add the same two values as GitHub Actions **Variables**, re-run "Deploy to Pages".

## Deploying (needs you)
`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages (manual trigger). To use it:
1. GitHub repo -> Settings -> Pages -> Source: **GitHub Actions** (Pages on a private repo needs a paid plan; otherwise make it public or use Netlify/Vercel drag-and-drop of `dist/`).
2. Actions tab -> "Deploy to Pages" -> Run workflow. URL will be `https://<user>.github.io/terraceb/`.
3. On the iPhone: open the URL in Safari -> Share -> Add to Home Screen.

## Accessibility fix (2026-09-19, this session)
- Found: the map's SVG building shapes (102 of them) were mouse/touch-only - no keyboard or screen-reader path
  reached a building's sheet, so the spec's "tap a building -> nearest parking" journey (Section 6) was unreachable
  without a pointer. The map's own aria-label already said "Use the List tab for a text alternative," but the List
  only searched garages/lots.
- Fix: `ui/list.ts` now also searches `BUILDINGS` (only once the user types a query, so the default browse list
  stays exactly "every garage and lot" per spec Section 6) and renders a "Buildings" section; selecting one reuses
  the existing generic `Selection` plumbing (fly-to, `.is-selected` highlight, sheet) with no other changes needed.
  Updated `scripts/smoke.mjs` to assert this path end-to-end (search "burruss" -> select from list -> sheet with 3
  nearest-parking rows) and to require Node 26 for native `.ts` execution (npm install/build/check/smoke all
  re-verified: 45/45 tests, typecheck clean, 41/41 smoke checks at 430x900/375x667/1280x800).
- Environment note: this Mac had no Node/npm installed; installed Node v26.9.0 to `~/.local/node` (no sudo) and
  added it to `~/.zshrc` PATH with the user's OK.

## Known cosmetic items (not blocking)
- At overview zoom the five ADA lot markers can sit on top of a nearby landmark label (e.g. "Squires Student Center", "Newman Library").
- Some lot polygons are thin slivers (Drillfield roads) and draw as stray blue lines when ADA-flagged; this is real GIS geometry.
- Drillfield ellipse is an estimate; 102 vs the spec's 92 buildings.

## Work log
- 15:10-15:40 Real Supabase project connected: first check failed with PGRST205 (migration not yet applied), user ran it, `check:supabase` passes; live build renders real rows.
- 14:35-15:10 Supabase feed: pure client + validators + tests, migration/seed/simulator SQL, poller + chip + in-place refresh, build guard, mock-Supabase e2e (`smoke:live`), `check:supabase`, docs.
- 14:15-14:35 Overview declutter (only garages + ADA lot markers until zoomed in), fallback screenshots in `docs/fallback/`.
- 14:00-14:15 Cross-view number audit + contrast tests + ARCHITECTURE.md + README + Pages workflow.
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
| ~~ARCHITECTURE.md + README + task split~~ done | done |
| ~~Phase 5 automated QA~~ done | done |
| ~~E2E script~~ done: `scripts/smoke.mjs` | done |
| Polish from QA (label density, marker overlap, Drillfield tune) | 30 min |
| **User-only:** choose host + deploy over HTTPS (Vercel/Netlify/GitHub Pages), test on a real iPhone | 15-30 min |
| **Team-only:** Phase 6 rehearsal x2, fallback screenshots on the demo machine, confirm ADA lot + demo numbers | 15-30 min |

## Open questions / needs from the user
- Supabase project is connected locally (`.env.local`, git-ignored). For the DEPLOYED site the two public values must also be added as GitHub Actions Variables.
- Hosting choice for the HTTPS deploy (needed for iPhone install + service worker). Nothing to do until I finish QA.
- Teammate to confirm the 5th ADA lot and demo garage numbers (spec header asks for team confirmation).
- Optional later: LLM-backed assistant (needs API key + proxy) and Capacitor/Xcode wrapper.

## Commands
`npm run data` | `npm run build` | `npm run dev` (watch) | `npm test` | `npm run typecheck` | `npm run check` (all three)
