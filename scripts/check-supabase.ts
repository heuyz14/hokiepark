/**
 * Verifies a real Supabase project is wired up correctly. Reads HOKIEPARK_SUPABASE_URL / _ANON_KEY from the
 * environment (npm run check:supabase loads .env.local) and NEVER prints the key. Checks:
 *   1. the anon key can read public.garage_levels and the rows pass the app's own validator
 *   2. the seed is present for every garage the app knows
 *   3. SECURITY: the anon key can NOT write (a no-op PATCH must be rejected by RLS/grants)
 */
import { GARAGES } from "../src/data/index.ts";
import { parseLiveConfig } from "../src/lib/live-config.ts";
import { fetchOccupancy, latestUpdate } from "../src/lib/occupancy-remote.ts";

const fail = (msg: string): never => {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
};

let cfg;
try {
  cfg = parseLiveConfig(process.env.HOKIEPARK_SUPABASE_URL, process.env.HOKIEPARK_SUPABASE_ANON_KEY, process.env.HOKIEPARK_POLL_MS);
} catch (e) {
  fail((e as Error).message);
}
if (!cfg) fail("HOKIEPARK_SUPABASE_URL / HOKIEPARK_SUPABASE_ANON_KEY are not set. Copy .env.example to .env.local and fill them in.");
const c = cfg!;
console.log(`project: ${new URL(c.url).host}`);

let rows;
try {
  rows = await fetchOccupancy(c);
} catch (e) {
  const m = (e as Error).message;
  if (/HTTP 401|HTTP 403/.test(m)) fail(`${m} - the anon/publishable key is wrong or from a different project.`);
  if (/HTTP 404/.test(m)) fail(`${m} - table public.garage_levels not found. Run supabase/migrations/20260919000000_garage_levels.sql in the SQL editor.`);
  fail(m);
}
rows = rows!;
if (!rows.length) fail("garage_levels is empty. Run supabase/seed.sql in the SQL editor.");
console.log(`PASS  read ${rows.length} valid rows`);

for (const g of GARAGES) {
  const n = rows.filter((r) => r.garage_id === g.id).length;
  if (n !== g.levels.length) fail(`${g.name}: database has ${n} levels, app expects ${g.levels.length}. Re-run supabase/seed.sql.`);
}
console.log(`PASS  every garage present (${GARAGES.map((g) => g.id).join(", ")})`);

const ageMin = Math.round((Date.now() - latestUpdate(rows)) / 60000);
console.log(`INFO  newest row updated ${ageMin} min ago${ageMin > 5 ? " (fine unless you expect the simulator to be running)" : ""}`);

// Security: a client with the anon key must not be able to write. Send a NO-OP update (same value), so even a
// misconfigured project is unharmed.
const first = rows[0]!;
const headers: Record<string, string> = { apikey: c.anonKey, "Content-Type": "application/json", Prefer: "return=minimal" };
if (c.anonKey.startsWith("eyJ")) headers.Authorization = `Bearer ${c.anonKey}`;
const res = await fetch(`${c.url}/rest/v1/garage_levels?garage_id=eq.${first.garage_id}&level_index=eq.${first.level_index}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ occupied: first.occupied }),
  signal: AbortSignal.timeout(8000),
});
if (res.ok) fail("SECURITY: the anon key was able to WRITE to garage_levels. Re-run the migration (RLS + revoke) before going live.");
console.log(`PASS  anon key cannot write (HTTP ${res.status})`);
console.log("\nAll good. Run `npm run build` - it should report: live feed: ON.");
