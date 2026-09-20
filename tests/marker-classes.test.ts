import { test } from "node:test";
import assert from "node:assert/strict";
import { withLibraryClasses } from "../src/ui/format.ts";

test("BUG REPRO: refreshing a marker's classes keeps MapLibre's (maplibregl-marker), or the marker loses position:absolute and renders in the wrong place", () => {
  const afterMapLibreAddsItsClass = ["marker", "marker-garage", "st-open", "maplibregl-marker", "maplibregl-marker-anchor-center"];
  const next = withLibraryClasses(afterMapLibreAddsItsClass, "marker marker-garage st-full is-selected acc-yes");
  const set = new Set(next.split(" "));
  assert.ok(set.has("maplibregl-marker"), next);
  assert.ok(set.has("maplibregl-marker-anchor-center"), next);
  for (const c of ["marker", "marker-garage", "st-full", "is-selected", "acc-yes"]) assert.ok(set.has(c), c);
  assert.ok(!set.has("st-open"), "the app's own stale state class is replaced, not kept");
});

test("withLibraryClasses copes with empty input, extra spaces and no library classes", () => {
  assert.equal(withLibraryClasses([], "a  b"), "a b");
  assert.equal(withLibraryClasses(["x", "y"], " a "), "a");
  assert.equal(withLibraryClasses(new Set(["maplibregl-marker"]), ""), "maplibregl-marker");
});

test("each garage marker is centred on its own footprint, within the footprint's bounds", async () => {
  const { GARAGES } = await import("../src/data/garages.ts");
  for (const g of GARAGES) {
    const pts = g.footprint.flat();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    assert.ok(g.center.lon >= Math.min(...xs) && g.center.lon <= Math.max(...xs), `${g.id} lon inside footprint bounds`);
    assert.ok(g.center.lat >= Math.min(...ys) && g.center.lat <= Math.max(...ys), `${g.id} lat inside footprint bounds`);
  }
});

test("marker scale: smaller zoomed out, full size near street level, capped both ways", async () => {
  const { markerScale } = await import("../src/ui/format.ts");
  assert.equal(markerScale(10), 0.68);
  assert.ok(markerScale(15) > markerScale(14) && markerScale(16) > markerScale(15));
  assert.ok(markerScale(16) >= 0.95 && markerScale(16) <= 1.05);
  assert.equal(markerScale(20), 1.1);
});
