import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSeedSql } from "../src/lib/seed-sql.ts";
import { SEED_LEVELS } from "../src/data/garages.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("supabase/seed.sql is in sync with src/data/garages.ts (run `npm run seed` if this fails)", () => {
  assert.equal(read("supabase/seed.sql"), renderSeedSql(SEED_LEVELS));
});

test("seed SQL escapes quotes and covers every level", () => {
  const sql = renderSeedSql({ g: [{ label: "Faculty's level", capacity: 10, occupied: 1, adaCapacity: 1, adaOccupied: 0 }] });
  assert.match(sql, /'Faculty''s level'/);
  const total = Object.values(SEED_LEVELS).reduce((n, ls) => n + ls.length, 0);
  assert.equal((read("supabase/seed.sql").match(/^\s+\('/gm) ?? []).length, total);
});

test("migration keeps the table read-only for API roles and has RLS on", () => {
  const sql = read("supabase/migrations/20260919000000_garage_levels.sql");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /for select\s+to anon, authenticated/i);
  assert.match(sql, /grant select on public\.garage_levels to anon, authenticated/i);
  assert.doesNotMatch(sql, /for (insert|update|delete|all)/i, "no write policies");
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete|all)/i, "no write grants");
  assert.match(sql, /revoke all on function public\.simulate_occupancy_tick\(\) from public, anon, authenticated/i);
});
