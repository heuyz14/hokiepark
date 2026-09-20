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
