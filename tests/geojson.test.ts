import { test } from "node:test";
import assert from "node:assert/strict";
import { footprintToGeoJSON, footprintBounds } from "../src/lib/geojson.ts";
import type { Footprint } from "../src/types.ts";

const square: Footprint = [
  [
    [-80.42, 37.23],
    [-80.41, 37.23],
    [-80.41, 37.22],
    [-80.42, 37.22],
    [-80.42, 37.23],
  ],
];

const twoParts: Footprint = [
  [
    [-80.42, 37.23],
    [-80.41, 37.23],
    [-80.41, 37.22],
    [-80.42, 37.22],
    [-80.42, 37.23],
  ],
  [
    [-80.44, 37.25],
    [-80.43, 37.25],
    [-80.43, 37.24],
    [-80.44, 37.24],
    [-80.44, 37.25],
  ],
];

test("footprintToGeoJSON wraps a single-ring footprint as a MultiPolygon with one polygon", () => {
  const g = footprintToGeoJSON(square);
  assert.equal(g.type, "MultiPolygon");
  assert.deepEqual(g.coordinates, [[square[0]]]);
});

test("footprintToGeoJSON treats each ring of a multi-part footprint as its own separate polygon, not a hole", () => {
  const g = footprintToGeoJSON(twoParts);
  assert.equal(g.coordinates.length, 2);
  assert.deepEqual(g.coordinates, [[twoParts[0]], [twoParts[1]]]);
});

test("footprintBounds returns the [minLon,minLat],[maxLon,maxLat] envelope of every vertex", () => {
  assert.deepEqual(footprintBounds(square), [
    [-80.42, 37.22],
    [-80.41, 37.23],
  ]);
});

test("footprintBounds spans a multi-part footprint's full extent, not just the first part", () => {
  assert.deepEqual(footprintBounds(twoParts), [
    [-80.44, 37.22],
    [-80.41, 37.25],
  ]);
});
