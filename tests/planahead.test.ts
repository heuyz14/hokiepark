import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, GARAGES, LOTS } from "../src/data/index.ts";
import { ARRIVE_BEFORE_MIN, FORECAST, bucketOf, effectiveDow, forecastPct, planAhead, planLabel, planScore, type PredictionFile } from "../src/lib/planahead.ts";
import { buildingOptions } from "../src/ui/plan.ts";
import { lotAccess } from "../src/lib/permits.ts";

const building = (n: string) => BUILDINGS.find((b) => b.name.toLowerCase().includes(n))!;
const data = { garages: GARAGES, lots: LOTS };
const plan = (n: string, permits: Parameters<typeof planAhead>[0]["permits"], dow = 3, minute = 840, ada = false) =>
  planAhead({ building: building(n), dow, minute, permits, ada }, data);

test("the bundled forecast covers exactly the app's lots and garage levels, with matching capacities (re-export databricks inputs if this fails)", () => {
  const expected = new Map<string, number>();
  for (const g of GARAGES) g.levels.forEach((l, i) => expected.set(`${g.id}:${i}`, l.capacity));
  for (const l of LOTS) expected.set(l.id, l.capacity);
  assert.equal(FORECAST.units.length, expected.size);
  for (const u of FORECAST.units) assert.equal(u.capacity, expected.get(u.id), u.id);
});

test("the forecast file is well-formed and honestly labelled", () => {
  assert.equal(FORECAST.kind, "SIMULATED");
  assert.match(FORECAST.disclaimer, /not measured occupancy/i);
  assert.equal(FORECAST.buckets, 96);
  for (const u of FORECAST.units) {
    assert.deepEqual(Object.keys(u.pct).sort(), ["1", "2", "3", "4", "5"]);
    for (const series of Object.values(u.pct)) {
      assert.equal(series.length, 96);
      assert.ok(series.every((v) => Number.isInteger(v) && v >= 0 && v <= 100));
    }
  }
});

test("buckets and weekends", () => {
  assert.equal(bucketOf(0), 0);
  assert.equal(bucketOf(14 * 60 + 14), 56);
  assert.equal(bucketOf(24 * 60), 95, "clamped");
  assert.equal(effectiveDow(3), 3);
  assert.equal(effectiveDow(6), 3);
  assert.equal(effectiveDow(7), 3);
  assert.equal(forecastPct("perry-street:0", 6, 600), forecastPct("perry-street:0", 3, 600), "weekends replay Wednesday");
  assert.equal(forecastPct("nope", 3, 600), null);
});

test("labels: risky under 8% open or under 5 spaces, filling up under 25% open", () => {
  assert.equal(planLabel(50, 100), "Likely open");
  assert.equal(planLabel(80, 40), "Filling up");
  assert.equal(planLabel(93, 20), "Risky");
  assert.equal(planLabel(60, 3), "Risky", "few absolute spaces is risky even at moderate fullness");
});

test("score rewards short walks and penalises fullness, and Risky is demoted", () => {
  assert.ok(planScore(5, 50, "Likely open") < planScore(10, 50, "Likely open"));
  assert.ok(planScore(5, 90, "Filling up") > planScore(5, 60, "Likely open"));
  assert.ok(planScore(1, 96, "Risky") > planScore(10, 60, "Likely open"));
});

test("no permit chosen: still shows where the parking is, but confirms nothing", () => {
  const r = plan("hancock", []);
  assert.equal(r.needsPermit, true, "the UI still needs to prompt for a permit");
  // Useful: a visitor, or someone about to pay hourly, gets ranked options instead of a dead end.
  assert.ok(r.checkSign.length > 0, "a driver without a permit must still see nearby parking");
  // Safe: nothing may be presented as confirmed when there is no permit to confirm it against.
  assert.deepEqual(r.recommended, [], "nothing is confirmed without a permit");
  for (const o of r.checkSign) {
    assert.notEqual(o.verdict, "yes", `${o.name} claimed a confident yes with no permit held`);
    assert.ok(o.predictedOpen >= 0 && o.predictedOpen <= o.capacity, `${o.name} must still carry a usable forecast`);
  }
});

test("SAFETY: every recommendation is a confident 'yes' from the permit rules, and none is ranked on a place the permit rules out", () => {
  for (const permits of [["cg"], ["cg-perry"], ["fs"], ["visitor"], ["evening"], ["resident"]] as const) {
    const r = plan("hancock", [...permits]);
    for (const o of r.recommended) {
      assert.equal(o.verdict, "yes", `${o.name} for ${permits}`);
      if (o.kind === "lot") assert.equal(lotAccess(LOTS.find((l) => l.id === o.id)!, [...permits]).verdict, "yes");
    }
    for (const o of r.checkSign) assert.equal(o.verdict, "check");
  }
});

test("SAFETY: a plain Commuter permit is never sent to Perry Street Garage; the Perry permit only gets its commuter level", () => {
  const cg = plan("hancock", ["cg"]);
  assert.ok(![...cg.recommended, ...cg.checkSign].some((o) => o.id === "perry-street"));
  const perry = plan("hancock", ["cg-perry"]).recommended.find((o) => o.id === "perry-street");
  assert.ok(perry, "the Perry permit should be offered the garage");
  assert.equal(perry.capacity, GARAGES.find((g) => g.id === "perry-street")!.levels[0]!.capacity, "only level 1 (the C/G section) counts");
  assert.match(perry.bestLevel!.label, /Commuter/);
});

test("SAFETY: lots with no known permit class are never recommended, only listed (capped) as 'check the sign'", () => {
  const unknown = new Set(LOTS.filter((l) => !l.classes.length).map((l) => l.id));
  for (const permits of [["cg"], ["fs"]] as const) {
    const r = plan("hancock", [...permits]);
    assert.ok(!r.recommended.some((o) => unknown.has(o.id)));
    assert.ok(r.checkSign.length <= 2);
  }
});

test("results are ranked, capped at 3, deterministic, and never exceed capacity", () => {
  const a = plan("squires student", ["visitor"], 3, 720);
  const b = plan("squires student", ["visitor"], 3, 720);
  assert.deepEqual(a, b);
  assert.ok(a.recommended.length <= 3);
  assert.deepEqual([...a.recommended].map((o) => o.score), [...a.recommended].map((o) => o.score).sort((x, y) => x - y));
  for (const o of a.recommended) {
    assert.ok(o.predictedOpen >= 0 && o.predictedOpen <= o.capacity);
    assert.ok(o.predictedPct >= 0 && o.predictedPct <= 100);
    assert.equal(o.walkMin, Math.max(1, Math.ceil(o.meters / 80)));
  }
});

test("arrival is 15 minutes before class and the forecast is read at arrival", () => {
  const r = plan("hancock", ["fs"], 2, 600);
  assert.equal(r.arriveMinute, 600 - ARRIVE_BEFORE_MIN);
  const o = r.recommended[0]!;
  const direct = forecastPct(o.kind === "garage" ? "" : o.id, 2, 585);
  if (o.kind === "lot") assert.equal(o.predictedPct, direct);
  assert.equal(plan("hancock", ["fs"], 2, 5).arriveMinute, 0, "clamped at midnight");
});

test("the forecast moves through the day: a class-heavy place is emptier at 3 am than at 11 am", () => {
  const o = plan("squires student", ["visitor"], 3, 11 * 60).recommended.find((x) => x.kind === "lot")!;
  const early = forecastPct(o.id, 3, 3 * 60)!;
  assert.ok(early < o.predictedPct, `${early} should be below ${o.predictedPct}`);
});

test("accessible credentials: ADA/Service lots open up and an ADA estimate is reported for garages", () => {
  const r = plan("hancock", ["cg-perry"], 3, 840, true);
  const g = r.recommended.find((o) => o.kind === "garage");
  if (g) assert.equal(typeof g.adaOpenEstimate, "number");
  const none = plan("hancock", ["cg-perry"], 3, 840, false).recommended.find((o) => o.kind === "garage");
  if (none) assert.equal(none.adaOpenEstimate, undefined);
});

test("a tiny custom forecast file flows through (the function does not depend on the bundled file)", () => {
  const file: PredictionFile = { ...FORECAST, units: FORECAST.units.map((u) => ({ ...u, pct: Object.fromEntries(Object.keys(u.pct).map((d) => [d, new Array<number>(96).fill(100)])) })) };
  const r = planAhead({ building: building("hancock"), dow: 3, minute: 840, permits: ["cg"], ada: false }, data, file);
  assert.ok(r.recommended.every((o) => o.label === "Risky" && o.predictedOpen === 0));
});

test("the destination picker lists every building A-Z before anything is typed", () => {
  const opts = buildingOptions();
  assert.equal(opts.length, BUILDINGS.length, "every building must be browsable without typing");
  const names = opts.map((o) => o.building.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en")), "must be alphabetical");
  // codes ride along so "HAN" is findable next to the full name
  const hancock = opts.find((o) => /Hancock/i.test(o.building.name));
  if (hancock) assert.ok(Array.isArray(hancock.codes));
});
