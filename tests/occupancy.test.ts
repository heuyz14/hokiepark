import { test } from "node:test";
import assert from "node:assert/strict";
import { availability, garageStatus, garageSummary, garageTotals, levelStatus, lotStatus, lotSummary, openAdaSpaces, openSpaces } from "../src/lib/occupancy.ts";
import { GARAGES, LOTS } from "../src/data/index.ts";
import type { Garage, Lot } from "../src/types.ts";

const info = { source: "test", permitDetail: "", overnightParking: "", payment: "", enforcement: "", location: "" };
const g = (levels: Garage["levels"]): Garage => ({ id: "t", name: "T", lat: 0, lon: 0, footprint: [], levels, info });
const lot = (capacity: number, occupied: number): Lot => ({
  id: "t", name: "T", number: 1, status: "Active", lat: 0, lon: 0, footprint: [], areaSqFt: 0,
  permit: "Commuter", hasADA: false, adaSpaces: 0, capacity, occupied,
});

test("open spaces never go negative", () => {
  assert.equal(openSpaces({ capacity: 10, occupied: 12 }), 0);
  assert.equal(openAdaSpaces({ adaCapacity: 2, adaOccupied: 5 }), 0);
  assert.equal(openSpaces({ capacity: 10, occupied: 4 }), 6);
});

test("availability thresholds: full at 0, limited under 10%, else open", () => {
  assert.equal(availability(0, 100), "full");
  assert.equal(availability(9, 100), "limited");
  assert.equal(availability(10, 100), "open");
  assert.equal(availability(5, 0), "full");
});

test("garageTotals sums levels", () => {
  const t = garageTotals(
    g([
      { label: "1", capacity: 100, occupied: 100, adaCapacity: 5, adaOccupied: 5 },
      { label: "2", capacity: 50, occupied: 20, adaCapacity: 3, adaOccupied: 1 },
    ]),
  );
  assert.deepEqual(t, { capacity: 150, occupied: 120, open: 30, adaCapacity: 8, adaOpen: 2 });
});

test("a garage at zero open spaces is full and reads '0 of N open'", () => {
  const full = g([{ label: "1", capacity: 10, occupied: 10, adaCapacity: 1, adaOccupied: 1 }]);
  assert.equal(garageStatus(full), "full");
  assert.equal(levelStatus(full.levels[0]!), "full");
  assert.equal(garageSummary(full), "0 of 10 open, 0 accessible open");
});

test("demo data invariants: ADA is a subset of capacity/occupancy and nothing exceeds capacity", () => {
  assert.equal(GARAGES.length, 2);
  for (const garage of GARAGES) {
    assert.ok(garage.levels.length > 0);
    for (const l of garage.levels) {
      const at = `${garage.name} / ${l.label}`;
      assert.ok(l.occupied >= 0 && l.occupied <= l.capacity, `${at}: occupied out of range`);
      assert.ok(l.adaOccupied >= 0 && l.adaOccupied <= l.adaCapacity, `${at}: ADA occupied out of range`);
      assert.ok(l.adaCapacity <= l.capacity, `${at}: ADA capacity exceeds capacity`);
      assert.ok(l.adaOccupied <= l.occupied, `${at}: ADA occupied exceeds occupied`);
    }
  }
});

test("demo data covers the Phase 5 edge cases", () => {
  const levels = GARAGES.flatMap((x) => x.levels);
  assert.ok(levels.some((l) => openSpaces(l) === 0), "need a full level");
  assert.ok(levels.some((l) => openAdaSpaces(l) === 0), "need a level with no open ADA");
  assert.ok(levels.some((l) => openAdaSpaces(l) > 0), "need a level with open ADA");
});

test("lotStatus uses the same open/capacity thresholds as garages", () => {
  assert.equal(lotStatus(lot(100, 100)), "full");
  assert.equal(lotStatus(lot(100, 92)), "limited");
  assert.equal(lotStatus(lot(100, 50)), "open");
});

test("lotSummary reports spots open of capacity and the permit type", () => {
  assert.equal(lotSummary(lot(180, 168)), "Lot &middot; 12 of 180 open &middot; Commuter");
});

test("demo data invariants: every lot has a capacity, occupied never exceeds it, and ADA spaces fit within capacity", () => {
  for (const l of LOTS) {
    assert.ok(l.capacity > 0, `${l.name}: capacity must be positive`);
    assert.ok(l.occupied >= 0 && l.occupied <= l.capacity, `${l.name}: occupied out of range`);
    assert.ok(l.adaSpaces <= l.capacity, `${l.name}: ADA spaces exceed capacity`);
  }
});

test("lot demo data covers a full lot and a near-full (limited) lot", () => {
  assert.ok(LOTS.some((l) => openSpaces(l) === 0), "need a full lot");
  assert.ok(LOTS.some((l) => lotStatus(l) === "limited"), "need a limited lot");
});

test("lot capacity is derived from each lot's real GIS polygon area, not a flat guess", () => {
  for (const l of LOTS) {
    assert.ok(l.areaSqFt > 0, `${l.name}: should carry a real GIS area`);
    assert.ok(l.capacity >= 10 && l.capacity <= 900, `${l.name}: capacity ${l.capacity} outside the plausible range`);
  }
  // a much bigger real lot should get a noticeably bigger derived capacity than a much smaller one
  const big = LOTS.find((l) => l.id === "lot-stadium")!;
  const small = LOTS.find((l) => l.id === "lot-torgersen")!;
  assert.ok(big.areaSqFt > small.areaSqFt * 5 && big.capacity > small.capacity * 2, "capacity should track real lot size");
});

test("occupancy is deterministic (stable across runs), not random", () => {
  const a = LOTS.find((l) => l.id === "lot-durham")!.occupied;
  const b = LOTS.find((l) => l.id === "lot-durham")!.occupied;
  assert.equal(a, b);
});

test("lots with no real permit signal default to Mixed; originally-curated lots keep their specific type", () => {
  assert.equal(LOTS.find((l) => l.id === "lot-owens")!.permit, "Resident", "curated lots keep their assigned type");
  assert.equal(LOTS.find((l) => l.id === "lot-duck-pond-dr")!.permit, "Mixed", "newly-added lots default to Mixed - no real signal to assign a specific audience");
});

test("garage capacities match VT's officially published totals (parking.vt.edu), not a guess", () => {
  const perry = GARAGES.find((x) => x.id === "perry-street")!;
  const nec = GARAGES.find((x) => x.id === "north-end-center")!;
  assert.equal(garageTotals(perry).capacity, 1350, "Perry Street Garage's official capacity is 1350");
  assert.equal(garageTotals(nec).capacity, 800, "North End Center Garage's official capacity is 800");
});

test("every garage carries sourced practical info (permit, overnight, payment, enforcement, location)", () => {
  for (const garage of GARAGES) {
    const at = garage.name;
    assert.equal(garage.info.source, "parking.vt.edu", `${at}: should cite its source`);
    for (const key of ["permitDetail", "overnightParking", "payment", "enforcement", "location"] as const) {
      assert.ok(garage.info[key].length > 0, `${at}: missing info.${key}`);
    }
  }
});

test("lots the VT dataset actually covers (Stadium, Bookstore, Coliseum West) carry sourced practical info; others don't", () => {
  const covered = ["lot-stadium", "lot-bookstore", "lot-coliseum-west"];
  for (const id of covered) {
    const l = LOTS.find((x) => x.id === id)!;
    assert.ok(l.info, `${id}: should have sourced info`);
    assert.equal(l.info!.source, "parking.vt.edu");
  }
  for (const l of LOTS) {
    if (!covered.includes(l.id)) assert.equal(l.info, undefined, `${l.id}: should not have fabricated info`);
  }
});

test("Stadium and Bookstore permit types corrected to match VT's real eligibility rules", () => {
  assert.equal(LOTS.find((l) => l.id === "lot-stadium")!.permit, "Resident", "Stadium is resident + event parking, not commuter");
  assert.equal(LOTS.find((l) => l.id === "lot-bookstore")!.permit, "Mixed", "Bookstore is paid hourly parking open to anyone, not visitor-only");
});

test("all of VT's real Main Campus lots are included (85, incl. Duck Pond Dr.), five flagged ADA", () => {
  assert.equal(LOTS.length, 85);
  assert.ok(LOTS.some((l) => l.id === "lot-duck-pond-dr"), "Duck Pond Dr. should be included");
  const ada = LOTS.filter((l) => l.hasADA);
  assert.equal(ada.length, 5);
  for (const id of ["lot-squires", "lot-coliseum-west", "lot-bookstore", "lot-drillfield-north"]) {
    assert.ok(ada.some((l) => l.id === id), `${id} should have ADA`);
  }
  assert.ok(LOTS.every((l) => (l.hasADA ? l.adaSpaces > 0 : l.adaSpaces === 0)));
});
