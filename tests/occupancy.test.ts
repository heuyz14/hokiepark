import { test } from "node:test";
import assert from "node:assert/strict";
import { availability, garageStatus, garageSummary, garageTotals, levelStatus, openAdaSpaces, openSpaces } from "../src/lib/occupancy.ts";
import { GARAGES, LOTS } from "../src/data/index.ts";
import type { Garage } from "../src/types.ts";

const g = (levels: Garage["levels"]): Garage => ({ id: "t", name: "T", lat: 0, lon: 0, footprint: [], levels });

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
      { label: "1", classes: [], capacity: 100, occupied: 100, adaCapacity: 5, adaOccupied: 5 },
      { label: "2", classes: [], capacity: 50, occupied: 20, adaCapacity: 3, adaOccupied: 1 },
    ]),
  );
  assert.deepEqual(t, { capacity: 150, occupied: 120, open: 30, adaCapacity: 8, adaOpen: 2 });
});

test("a garage at zero open spaces is full and reads '0 of N open'", () => {
  const full = g([{ label: "1", classes: [], capacity: 10, occupied: 10, adaCapacity: 1, adaOccupied: 1 }]);
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

test("spec: exactly five lots are flagged ADA, 19 lots total, incl. the named ones", () => {
  assert.equal(LOTS.length, 19);
  const ada = LOTS.filter((l) => l.hasADA);
  assert.equal(ada.length, 5);
  for (const id of ["lot-squires", "lot-coliseum-west", "lot-bookstore", "lot-drillfield-north"]) {
    assert.ok(ada.some((l) => l.id === id), `${id} should have ADA`);
  }
  assert.ok(LOTS.every((l) => (l.hasADA ? l.adaSpaces > 0 : l.adaSpaces === 0)));
});
