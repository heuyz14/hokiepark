import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, LOTS } from "../src/data/index.ts";

test("data sanity: every item has a footprint and a lat/lon on the Blacksburg campus", () => {
  for (const x of [...BUILDINGS, ...LOTS]) {
    assert.ok(x.footprint.length > 0, `${x.name} has no footprint`);
    assert.ok(x.lat > 37.21 && x.lat < 37.24 && x.lon > -80.44 && x.lon < -80.41, `${x.name} off campus`);
  }
  assert.ok(BUILDINGS.length >= 90, `only ${BUILDINGS.length} buildings`);
  assert.equal(new Set(BUILDINGS.map((b) => b.id)).size, BUILDINGS.length, "duplicate building ids");
});
