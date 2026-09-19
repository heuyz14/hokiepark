import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUCKETS, buildLevelCurves, coverage, haversineM, percentile, pull, smooth, staffShape, type GarageIn, type Placed } from "../src/lib/demand.ts";
import { renderCurvesSql } from "../src/lib/curves-sql.ts";
import { GARAGES } from "../src/data/garages.ts";
import type { MeetingGroup } from "../src/lib/timetable.ts";

const garage: GarageIn = {
  id: "g",
  lat: 37.23,
  lon: -80.42,
  levels: [
    { classes: ["perry-cg"], capacity: 100 },
    { classes: ["perry-fs"], capacity: 100 },
    { classes: ["perry-fs"], capacity: 100 },
  ],
};
const nextDoor = { lat: 37.23, lon: -80.42 };
const meet = (days: MeetingGroup["days"], startMin: number, endMin: number, capacity: number): Placed => ({
  group: { building: "X", days, startMin, endMin, capacity, sections: 1 },
  ...nextDoor,
});
const at = (curves: ReturnType<typeof buildLevelCurves>, level: number, dow: number) => curves.find((c) => c.levelIndex === level && c.dow === dow)!.pct;
const bucket = (h: number, m = 0) => h * 4 + m / 15;

test("pull falls off with distance and is zero past the radius", () => {
  assert.equal(pull(0), 1);
  assert.ok(pull(300) > pull(600));
  assert.equal(pull(900), 0);
  assert.equal(pull(5000), 0);
});

test("haversineM is ~111 km per degree of latitude", () => {
  const d = haversineM({ lat: 37, lon: -80 }, { lat: 38, lon: -80 });
  assert.ok(Math.abs(d - 111195) < 300, String(d));
});

test("staffShape is ~0 overnight, ~1 midday, and drains in the evening", () => {
  assert.ok(staffShape(3 * 60) < 0.01);
  assert.ok(staffShape(12 * 60) > 0.99);
  assert.ok(staffShape(20 * 60) < 0.2);
});

test("percentile uses nearest rank and tolerates empty input", () => {
  assert.equal(percentile([], 0.95), 0);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5);
});

test("curves: 5 days x every level, 96 buckets, integer percents in 0..100, deterministic", () => {
  const a = buildLevelCurves([meet(["M"], 600, 650, 200)], [garage]);
  const b = buildLevelCurves([meet(["M"], 600, 650, 200)], [garage]);
  assert.equal(a.length, 5 * 3);
  for (const c of a) {
    assert.equal(c.pct.length, BUCKETS);
    for (const v of c.pct) assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, `${v}`);
  }
  assert.deepEqual(a, b);
});

test("the commuter level follows class activity: a Monday 10:00 class raises Monday, not Tuesday", () => {
  const curves = buildLevelCurves([meet(["M"], 600, 650, 200)], [garage]);
  const mon = at(curves, 0, 1);
  const tue = at(curves, 0, 2);
  assert.ok(mon[bucket(10, 15)]! > mon[bucket(3)]! + 50, "busy during class vs 3am");
  assert.ok(mon[bucket(10, 15)]! > tue[bucket(10, 15)]! + 50, "Monday-only class does not raise Tuesday");
  assert.ok(mon[bucket(9, 45)]! > mon[bucket(9)]!, "cars arrive shortly before class");
  assert.ok(mon[bucket(11, 30)]! < mon[bucket(10, 15)]!, "and drain after it");
});

test("a class far from the garage has no effect", () => {
  const far: Placed = { ...meet(["M"], 600, 650, 200), lat: 37.3, lon: -80.42 };
  const withFar = buildLevelCurves([far], [garage]);
  const none = buildLevelCurves([], [garage]);
  assert.deepEqual(withFar, none);
});

test("faculty levels follow the staff workday even with no classes, and Friday is lighter", () => {
  const curves = buildLevelCurves([], [garage]);
  // level 2 is the partially filled one (level 1 saturates first), so it shows the difference
  const wed = at(curves, 2, 3);
  const fri = at(curves, 2, 5);
  assert.ok(wed[bucket(12)]! > wed[bucket(3)]! + 20);
  assert.ok(fri[bucket(12)]! < wed[bucket(12)]!);
});

test("levels of one group fill bottom-up", () => {
  const curves = buildLevelCurves([], [garage]);
  for (let b = 0; b < BUCKETS; b++) assert.ok(at(curves, 1, 3)[b]! >= at(curves, 2, 3)[b]!, `bucket ${b}`);
});

test("smooth is a centered moving average with shrinking edge windows", () => {
  assert.deepEqual(smooth([0, 0, 9, 0, 0], 1), [0, 3, 3, 3, 0]);
  assert.deepEqual(smooth([4, 8], 5), [6, 6]);
});

test("real curves do not saw-tooth: a garage's total fill moves at most 15 points between adjacent quarter-hours", () => {
  // (Per LEVEL jumps can be large by design: the morning ramp fills one middle level bottom-up. The total is what smoothing controls.)
  const sql = read("supabase/curves.seed.sql");
  const rows = [...sql.matchAll(/\('([a-z-]+)', (\d+), (\d), '\{([\d,]+)\}'\)/g)];
  let worst = 0;
  for (const g of GARAGES) {
    const cap = g.levels.reduce((n, l) => n + l.capacity, 0);
    for (const dow of ["1", "2", "3", "4", "5"]) {
      const total = new Array<number>(BUCKETS).fill(0);
      for (const m of rows.filter((r) => r[1] === g.id && r[3] === dow)) {
        m[4]!.split(",").forEach((v, b) => (total[b]! += (Number(v) * g.levels[Number(m[2])]!.capacity) / 100));
      }
      for (let b = 1; b < BUCKETS; b++) worst = Math.max(worst, (100 * Math.abs(total[b]! - total[b - 1]!)) / cap);
    }
  }
  assert.ok(worst <= 15, `largest one-bucket change in garage total is ${worst.toFixed(1)} points`);
  // The commuter level (Perry L1) has no bottom-up cascade and is the class-driven one; it used to jump 95 -> 59 at every class change.
  let cgWorst = 0;
  for (const m of rows.filter((r) => r[1] === "perry-street" && r[2] === "0")) {
    const a = m[4]!.split(",").map(Number);
    for (let b = 1; b < a.length; b++) cgWorst = Math.max(cgWorst, Math.abs(a[b]! - a[b - 1]!));
  }
  assert.ok(cgWorst <= 25, `largest one-bucket change on the commuter level is ${cgWorst} points`);
});

test("coverage counts seat-meetings on known buildings", () => {
  const groups: MeetingGroup[] = [
    { building: "A", days: ["M", "W"], startMin: 540, endMin: 600, capacity: 10, sections: 1 },
    { building: "B", days: ["M"], startMin: 540, endMin: 600, capacity: 30, sections: 1 },
  ];
  assert.deepEqual(coverage(groups, (c) => c === "A"), { placedSeats: 20, totalSeats: 50 });
});

// ---- committed data ----
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("supabase/curves.seed.sql is in sync with the timetable data (run `npm run curves` if this fails)", () => {
  const timetable = JSON.parse(read("data/raw/timetable.json")) as { meetings: MeetingGroup[] };
  const codes = JSON.parse(read("data/timetable-building-codes.json")) as Record<string, { num: string }>;
  const gis = JSON.parse(read("data/raw/buildings.raw.json")).features as { attributes: { bldg_num: string; latitude: number; longitude: number } }[];
  const point = new Map<string, { lat: number; lon: number }>();
  for (const f of gis) if (f.attributes.bldg_num && !point.has(f.attributes.bldg_num)) point.set(f.attributes.bldg_num, { lat: f.attributes.latitude, lon: f.attributes.longitude });
  const placed: Placed[] = [];
  for (const group of timetable.meetings) {
    const p = codes[group.building] && point.get(codes[group.building]!.num);
    if (p) placed.push({ group, ...p });
  }
  const curves = buildLevelCurves(placed, GARAGES.map((g) => ({ id: g.id, lat: g.lat, lon: g.lon, levels: g.levels })));
  assert.equal(read("supabase/curves.seed.sql"), renderCurvesSql(curves));
  const levels = GARAGES.reduce((n, g) => n + g.levels.length, 0);
  assert.equal(curves.length, levels * 5);
});

test("building-code map points only at real GIS buildings and covers >= 98% of timetable seats", () => {
  const timetable = JSON.parse(read("data/raw/timetable.json")) as { meetings: MeetingGroup[] };
  const codes = JSON.parse(read("data/timetable-building-codes.json")) as Record<string, { num: string }>;
  const nums = new Set((JSON.parse(read("data/raw/buildings.raw.json")).features as { attributes: { bldg_num: string } }[]).map((f) => f.attributes.bldg_num));
  for (const [code, v] of Object.entries(codes)) assert.ok(nums.has(v.num), `${code} -> ${v.num} is not in the GIS data`);
  const { placedSeats, totalSeats } = coverage(timetable.meetings, (c) => c in codes);
  assert.ok(placedSeats / totalSeats >= 0.98, `${placedSeats}/${totalSeats}`);
});

test("migration keeps curves and config private to API roles", () => {
  const sql = read("supabase/migrations/20260919120000_class_schedule_curves.sql");
  for (const t of ["garage_level_curves", "sim_config"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from anon, authenticated`, "i"));
  }
  assert.doesNotMatch(sql, /create policy|grant\s+(select|insert|update|delete|all)/i);
  assert.match(sql, /revoke all on function public\.simulate_occupancy_tick\(\) from public, anon, authenticated/i);
});
