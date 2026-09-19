import { test } from "node:test";
import assert from "node:assert/strict";
import { DRILLFIELD, DRILLFIELD_CENTER } from "../src/data/drillfield.ts";
import { BUILDINGS, LOTS } from "../src/data/index.ts";

function inside(ring: [number, number][], [x, y]: [number, number]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

test("Drillfield is open space: no building vertex falls inside it", () => {
  const ring = DRILLFIELD[0]!;
  const offenders = BUILDINGS.filter((b) => b.footprint.some((r) => r.some((p) => inside(ring, p)))).map((b) => b.name);
  assert.deepEqual(offenders, []);
});

test("Drillfield polygon is closed and contains its center", () => {
  const ring = DRILLFIELD[0]!;
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  assert.ok(inside(ring, [DRILLFIELD_CENTER.lon, DRILLFIELD_CENTER.lat]));
});

test("data sanity: every item has a footprint and a lat/lon on the Blacksburg campus", () => {
  for (const x of [...BUILDINGS, ...LOTS]) {
    assert.ok(x.footprint.length > 0, `${x.name} has no footprint`);
    assert.ok(x.lat > 37.21 && x.lat < 37.24 && x.lon > -80.43 && x.lon < -80.41, `${x.name} off campus`);
  }
  assert.ok(BUILDINGS.length >= 90, `only ${BUILDINGS.length} buildings`);
  assert.equal(new Set(BUILDINGS.map((b) => b.id)).size, BUILDINGS.length, "duplicate building ids");
});
