import { test } from "node:test";
import assert from "node:assert/strict";
import { buildingFromText, filterBuildings, filterByName, matches, resolveBuilding } from "../src/lib/search.ts";
import { nearest, walkMinutes } from "../src/lib/nearby.ts";
import { BUILDINGS, GARAGES, LOTS } from "../src/data/index.ts";

test("matches is case, punctuation and token-order insensitive", () => {
  assert.ok(matches("Graduate Life Center West", "grad west"));
  assert.ok(matches("Stanger St. ADA", "stanger st ada"));
  assert.ok(matches("Perry Street Garage", "  PERRY  "));
  assert.ok(!matches("Perry Street Garage", "cassell"));
  assert.ok(matches("anything", ""));
});

test("official building abbreviations resolve case-insensitively and rank exact codes first", () => {
  assert.equal(resolveBuilding(BUILDINGS, "TORG")?.name, "Torgersen Hall");
  assert.equal(resolveBuilding(BUILDINGS, "han")?.name, "Hancock Hall");
  assert.equal(resolveBuilding(BUILDINGS, "aj e")?.name, "Ambler Johnston Hall - East Wing");
  assert.equal(filterBuildings(BUILDINGS, "bur")[0]?.name, "Burruss Hall");
  assert.equal(resolveBuilding(BUILDINGS, "not-a-building"), null);
  assert.equal(buildingFromText(BUILDINGS, "what's new on campus"), null, "ordinary words that are also short codes do not become destinations");
  assert.equal(buildingFromText(BUILDINGS, "class at new")?.name, "Newman Hall");
});

test("partial names find real items; misspellings return nothing (fuzziness is cut)", () => {
  const all = [...GARAGES, ...LOTS];
  assert.deepEqual(filterByName(all, "perry").map((x) => x.id), ["perry-street"]);
  assert.ok(filterByName(all, "squ").some((x) => x.id === "lot-squires"));
  assert.equal(filterByName(all, "cassel").length, 0);
  assert.equal(filterByName(all, "zzz").length, 0);
});

test("nearest returns closest first with sane distances", () => {
  const squires = LOTS.find((l) => l.id === "lot-squires")!;
  const [first, second] = nearest([...LOTS, ...GARAGES], squires, 2);
  assert.equal(first!.item.id, "lot-squires");
  // distance is to the nearest footprint vertex, so a lot measured from its own centroid is near 0, not exactly 0
  assert.ok(first!.meters < 60, `own lot should be very close, got ${first!.meters}`);
  assert.ok(second!.meters >= first!.meters);
  assert.equal(walkMinutes(0), 1);
  assert.equal(walkMinutes(161), 3);
});
