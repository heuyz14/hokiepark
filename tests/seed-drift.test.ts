import { test } from "node:test";
import assert from "node:assert/strict";
import { findSeedDrift } from "../src/lib/seed-drift.ts";
import { SEED_LEVELS } from "../src/data/garages.ts";
import type { OccupancyRow } from "../src/lib/occupancy-remote.ts";

/** Rows exactly as `supabase/seed.sql` would leave them. */
const seedRows = (): OccupancyRow[] =>
  Object.entries(SEED_LEVELS).flatMap(([garage_id, ls]) => ls.map((l, i) => ({ garage_id, level_index: i, label: l.label, capacity: l.capacity, occupied: l.occupied, ada_capacity: l.adaCapacity, ada_occupied: l.adaOccupied, updated_at: "2026-09-19T18:00:00Z" })));

test("a freshly seeded database has no drift", () => {
  assert.deepEqual(findSeedDrift(seedRows(), SEED_LEVELS), { labels: [], capacities: [] });
});

test("live counts changing (occupied) is NOT drift", () => {
  const rows = seedRows().map((r) => ({ ...r, occupied: Math.max(r.ada_occupied, r.occupied - 3) }));
  assert.deepEqual(findSeedDrift(rows, SEED_LEVELS), { labels: [], capacities: [] });
});

test("an outdated capacity is reported with the level and both numbers", () => {
  const rows = seedRows();
  const perryL1 = rows.find((r) => r.garage_id === "perry-street" && r.level_index === 0)!;
  perryL1.capacity = Math.floor(perryL1.capacity / 2);
  perryL1.occupied = Math.min(perryL1.occupied, perryL1.capacity);
  const d = findSeedDrift(rows, SEED_LEVELS);
  assert.equal(d.capacities.length, 1);
  assert.match(d.capacities[0]!, /^perry-street L1: database \d+ spaces \(\d+ accessible\) vs app \d+ \(\d+\)$/);
  assert.equal(d.labels.length, 0);
});

test("an outdated ADA capacity alone is also reported", () => {
  const rows = seedRows();
  const r = rows.find((x) => x.garage_id === "north-end-center" && x.level_index === 1)!;
  r.ada_capacity = r.ada_capacity + 1;
  assert.equal(findSeedDrift(rows, SEED_LEVELS).capacities.length, 1);
});

test("a stale label is reported separately from capacity drift", () => {
  const rows = seedRows();
  rows[2]!.label = "old label";
  const d = findSeedDrift(rows, SEED_LEVELS);
  assert.equal(d.labels.length, 1);
  assert.equal(d.capacities.length, 0);
});

test("levels missing from the database are skipped here (the script reports level-count mismatches separately)", () => {
  const rows = seedRows().filter((r) => !(r.garage_id === "perry-street" && r.level_index === 4));
  assert.deepEqual(findSeedDrift(rows, SEED_LEVELS), { labels: [], capacities: [] });
});
