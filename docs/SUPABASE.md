# Live occupancy with Supabase

The app works with **no database** (bundled sample counts). Adding Supabase makes garage counts come from a table that
you can change live, and every view (map markers, list, detail sheet, assistant) updates within one poll interval.
Counts are still **simulated demo data**; there are no real sensors (spec Sections 9 and 14).

## How it works
```
Supabase Postgres  public.garage_levels  (RLS: anon may only SELECT)
      ^ writes: SQL editor / pg_cron simulator / service role only
      | GET /rest/v1/garage_levels   (apikey = public anon key, every 15 s)
browser  fetchOccupancy -> parseOccupancyRows (strict validation) -> applyOccupancy (all-or-nothing) -> GARAGES
      -> map.refreshGarages() + list.refresh() + sheet.render(preserveScroll)   (assistant reads GARAGES at ask time)
```
- **Offline / unconfigured / outage:** the app keeps the last known (or bundled) counts. A header chip says which:
  `Sample data` (feed off), `Connecting`, `Live . 12s ago`, `Offline`, or `Data 12m ago` (connected but the table is stale).
- **Zero new runtime dependencies:** a plain `fetch` to the REST API, no `supabase-js`.
- **Bad data is rejected as a whole:** any out-of-range or malformed row discards the payload, so a garage is never half-updated.

## Security model (AGENTS.md rules)
- Only the **project URL and anon/publishable key** are embedded in the bundle. They are public by design; RLS is the protection.
- **RLS is on**; the only policy is `select` for `anon, authenticated`. Write privileges are also revoked as defense in depth.
- The **service-role / secret key is never used by the app**. The build aborts if it sees one (`sb_secret_...` or a JWT with `role: service_role`).
- The simulator function is executable only by the database owner / pg_cron, not by API roles.
- Never commit `.env.local` (it is git-ignored). `.env.example` has names only.

## Setup (about 10 minutes, needs you)
1. **Create a project:** supabase.com -> New project (free tier is fine). Pick a region near Blacksburg (e.g. East US).
2. **Create the table:** SQL Editor -> paste all of `supabase/migrations/20260919000000_garage_levels.sql` -> Run.
3. **Load the sample rows:** SQL Editor -> paste all of `supabase/seed.sql` -> Run. (Re-running it resets the counts.)
4. **Copy the public values:** Project Settings -> API (or the "Connect" dialog): **Project URL** and the **anon / publishable** key.
   Do NOT copy the `service_role` / secret key.
5. **Configure locally:** `cp .env.example .env.local`, then fill in `HOKIEPARK_SUPABASE_URL` and `HOKIEPARK_SUPABASE_ANON_KEY`.
6. **Verify:** `npm run check:supabase`. It prints the host (never the key) and PASS lines: rows read and valid, all garages
   present, and "anon key cannot write".
7. **Build:** `npm run build` should report `live feed: ON (<your-project>.supabase.co)`. Open `dist/index.html` (or serve it): chip shows `Live`.
8. **Make it move (optional):**
   - Manual, best for judging: in the SQL editor run `select public.simulate_occupancy_tick();` and watch the app update.
   - Automatic: enable the `pg_cron` extension, then run `supabase/optional/schedule_simulator.sql` (nudges every minute).
   - Exact scenarios: `update public.garage_levels set occupied = capacity - 3 where garage_id = 'perry-street' and level_index = 1;`
9. **Deploy with the feed:** in the GitHub repo, Settings -> Secrets and variables -> Actions -> **Variables** tab, add
   `HOKIEPARK_SUPABASE_URL` and `HOKIEPARK_SUPABASE_ANON_KEY` (public values), then re-run "Deploy to Pages".
   Without them the deployed site simply shows sample data.

## Testing (no real project needed)
- Unit: `tests/occupancy-remote.test.ts`, `live-config.test.ts`, `seed.test.ts` (validation, all-or-nothing apply,
  key guard, seed in sync with `garages.ts`, migration stays read-only).
- End to end with a mock Supabase: `npm run smoke:live` (also `npm run smoke -- 375 667 --live`). It builds a feed-enabled
  bundle with a FAKE key, answers the requests from a controllable mock, and checks: a DB change reaches marker/list/sheet/
  assistant, an open sheet updates in place and keeps its scroll, an outage keeps last-known counts and recovers by itself,
  a malformed payload is rejected, and the cross-view number audit still holds after each change.
- Against your real project: `npm run check:supabase`.

## AGENTS.md "Database Change" workflow, mapped
| Step | Where |
| --- | --- |
| Migration | `supabase/migrations/20260919000000_garage_levels.sql` (+ generated `supabase/seed.sql`, `npm run seed`) |
| RLS policies | same migration: RLS on, select-only policy, write grants revoked |
| TypeScript types | `OccupancyRow` in `src/lib/occupancy-remote.ts` (validated at runtime, not just typed) |
| Queries | `fetchOccupancy` (single read), no writes from the client |
| Test with data | mock e2e above; `npm run check:supabase` against the real project |
| No service role in the browser | build-time guard in `src/lib/live-config.ts`, tested |

## Limits and next steps
- Polling every 15 s (`HOKIEPARK_POLL_MS`, min 1000). Supabase Realtime would push instead; not needed for a demo.
- Lots still have no live counts (no per-lot data exists); only garages are live.
- Production (spec Section 12): the same `garage_levels` shape would be served from Databricks/Unity Catalog behind an API.
