import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOccupancy, fetchOccupancy, latestUpdate, parseOccupancyRows, type OccupancyRow } from "../src/lib/occupancy-remote.ts";
import { SEED_LEVELS } from "../src/data/garages.ts";
import { GARAGES } from "../src/data/index.ts";
import { garageTotals } from "../src/lib/occupancy.ts";
import type { Garage } from "../src/types.ts";

const row = (o: Partial<OccupancyRow> = {}): OccupancyRow => ({ garage_id: "perry-street", level_index: 0, label: "L1", capacity: 100, occupied: 40, ada_capacity: 5, ada_occupied: 2, updated_at: "2026-09-19T18:00:00Z", ...o });
const garage = (): Garage => ({ id: "perry-street", name: "P", lat: 0, lon: 0, footprint: [], levels: [{ label: "old", classes: [], capacity: 10, occupied: 1, adaCapacity: 1, adaOccupied: 0 }] });

/** Rows equivalent to the bundled seed, as the database would return them. */
const seedRows = (): OccupancyRow[] =>
  Object.entries(SEED_LEVELS).flatMap(([gid, ls]) => ls.map((l, i) => row({ garage_id: gid, level_index: i, label: l.label, capacity: l.capacity, occupied: l.occupied, ada_capacity: l.adaCapacity, ada_occupied: l.adaOccupied })));

test("parse accepts valid rows", () => {
  assert.deepEqual(parseOccupancyRows([row()]), [row()]);
  assert.deepEqual(parseOccupancyRows([]), []);
});

test("parse rejects malformed payloads (untrusted input)", () => {
  const bad: [string, unknown][] = [
    ["not an array", { a: 1 }],
    ["null row", [null]],
    ["bad garage id", [row({ garage_id: "Perry Street!" })]],
    ["negative level", [row({ level_index: -1 })]],
    ["float count", [row({ occupied: 1.5 })]],
    ["string count", [{ ...row(), occupied: "40" }]],
    ["occupied > capacity", [row({ occupied: 101 })]],
    ["negative occupied", [row({ occupied: -1 })]],
    ["ada_capacity > capacity", [row({ ada_capacity: 101 })]],
    ["ada_occupied > ada_capacity", [row({ ada_occupied: 6 })]],
    ["ada_occupied > occupied", [row({ occupied: 1, ada_occupied: 2 })]],
    ["empty label", [row({ label: "" })]],
    ["bad timestamp", [row({ updated_at: "yesterday-ish" })]],
    ["duplicate level", [row(), row()]],
    ["too many rows", Array.from({ length: 501 }, (_, i) => row({ level_index: i % 99 }))],
  ];
  for (const [name, payload] of bad) assert.throws(() => parseOccupancyRows(payload), Error, name);
});

test("apply replaces levels, sorts by level_index, and reports change", () => {
  const g = garage();
  const changed = applyOccupancy([g], [row({ level_index: 1, label: "L2", occupied: 10 }), row({ level_index: 0 })]);
  assert.equal(changed, true);
  // known levels take their name from the app's signage (not the DB), and stay sorted by level_index
  assert.deepEqual(g.levels.map((l) => l.label), [SEED_LEVELS["perry-street"]![0]!.label, SEED_LEVELS["perry-street"]![1]!.label]);
  assert.equal(g.levels[0]!.adaOccupied, 2);
  assert.equal(g.levels[1]!.occupied, 10, "the live counts come from the DB");
});

test("SIGNAGE IS CODE: stale or edited DB labels never change a known level's label or permit classes", () => {
  const g = garage();
  const signage = SEED_LEVELS["perry-street"]!;
  applyOccupancy([g], [row({ level_index: 0, label: "Level 1 - SOMETHING ELSE", capacity: 120, occupied: 7 })]);
  assert.equal(g.levels[0]!.label, signage[0]!.label);
  assert.deepEqual(g.levels[0]!.classes, signage[0]!.classes);
  assert.equal(g.levels[0]!.occupied, 7, "...while the count still updates");
  assert.ok(g.levels[0]!.classes.length > 0, "a known level keeps its permit classes");
});

test("a level the code does not know keeps the DB label but has NO permit classes (never a confident yes)", () => {
  const g = garage();
  const extra = SEED_LEVELS["perry-street"]!.length; // one past the last known level
  applyOccupancy([g], [row({ level_index: extra, label: "Level 9 - Mystery" })]);
  assert.equal(g.levels[0]!.label, "Level 9 - Mystery");
  assert.deepEqual(g.levels[0]!.classes, []);
});

test("seed-equal rows reproduce the bundled levels INCLUDING labels and classes even if every DB label is stale", () => {
  const copy: Garage[] = GARAGES.map((x) => ({ ...x, levels: x.levels.map((l) => ({ ...l })) }));
  const stale = seedRows().map((r) => ({ ...r, label: `stale ${r.garage_id} ${r.level_index}` }));
  copy[0]!.levels[0]!.occupied = 0;
  applyOccupancy(copy, stale);
  assert.deepEqual(copy.map((x) => JSON.stringify(x.levels)), GARAGES.map((x) => JSON.stringify(x.levels)));
});

test("apply is a no-op (returns false) when nothing changed, so the UI can skip re-rendering", () => {
  const g = garage();
  applyOccupancy([g], [row()]);
  assert.equal(applyOccupancy([g], [row()]), false);
});

test("apply throws when no row matches a known garage (wrong table/project) and leaves data untouched", () => {
  const g = garage();
  const before = JSON.stringify(g.levels);
  assert.throws(() => applyOccupancy([g], [row({ garage_id: "other-garage" })]), /no known garage/);
  assert.equal(JSON.stringify(g.levels), before);
});

test("garages without rows keep their existing levels; unknown garages are ignored", () => {
  const a = garage();
  const b = { ...garage(), id: "north-end-center" };
  const beforeB = JSON.stringify(b.levels);
  applyOccupancy([a, b], [row(), row({ garage_id: "brand-new" })]);
  assert.equal(JSON.stringify(b.levels), beforeB);
});

test("database rows equal to the seed reproduce the bundled counts exactly (seed.sql and garages.ts agree)", () => {
  const copy: Garage[] = GARAGES.map((g) => ({ ...g, levels: g.levels.map((l) => ({ ...l })) }));
  copy[0]!.levels[0]!.occupied = 0; // perturb, then let the "database" restore it
  const before = copy.map((g) => garageTotals(g).open);
  applyOccupancy(copy, seedRows());
  assert.deepEqual(copy.map((g) => JSON.stringify(g.levels)), GARAGES.map((g) => JSON.stringify(g.levels)));
  assert.notDeepEqual(before, copy.map((g) => garageTotals(g).open));
});

test("latestUpdate returns the newest timestamp", () => {
  assert.equal(latestUpdate([row({ updated_at: "2026-09-19T18:00:00Z" }), row({ level_index: 1, updated_at: "2026-09-19T18:05:00Z" })]), Date.parse("2026-09-19T18:05:00Z"));
  assert.equal(latestUpdate([]), 0);
});

test("fetchOccupancy sends the apikey (+Bearer for JWT keys only), hits the right endpoint, and parses", async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify([row()]), { status: 200 });
  }) as unknown as typeof fetch;
  const rows = await fetchOccupancy({ url: "https://x.supabase.co", anonKey: "eyJhbGciOi.payload.sig", pollMs: 15000 }, fake);
  assert.equal(rows.length, 1);
  assert.match(seen[0]!.url, /^https:\/\/x\.supabase\.co\/rest\/v1\/garage_levels\?select=garage_id,/);
  assert.equal(seen[0]!.headers.Authorization, "Bearer eyJhbGciOi.payload.sig");
  await fetchOccupancy({ url: "https://x.supabase.co", anonKey: "sb_publishable_abc", pollMs: 15000 }, fake);
  assert.equal(seen[1]!.headers.apikey, "sb_publishable_abc");
  assert.equal(seen[1]!.headers.Authorization, undefined);
});

test("fetchOccupancy surfaces HTTP errors and invalid bodies as rejections", async () => {
  const cfg = { url: "https://x.supabase.co", anonKey: "sb_publishable_abc", pollMs: 15000 };
  await assert.rejects(fetchOccupancy(cfg, (async () => new Response("no", { status: 401 })) as unknown as typeof fetch), /HTTP 401/);
  await assert.rejects(fetchOccupancy(cfg, (async () => new Response("{not json", { status: 200 })) as unknown as typeof fetch));
  await assert.rejects(fetchOccupancy(cfg, (async () => new Response(JSON.stringify([{ garage_id: "perry-street" }]), { status: 200 })) as unknown as typeof fetch), /bad level_index/);
});
