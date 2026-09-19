import { test } from "node:test";
import assert from "node:assert/strict";
import { centeredOn, constrain, fitAspect, lerpBox, panBy, zoomAt, type ViewBox } from "../src/lib/viewport.ts";

const full: ViewBox = { x: 0, y: 0, w: 1000, h: 1600 };

test("zoomAt keeps the focal point fixed", () => {
  const vb = zoomAt(full, 2, 0.25, 0.75, full);
  assert.equal(vb.w, 500);
  assert.equal(vb.h, 800);
  // focal point in world coords before and after
  assert.equal(full.x + full.w * 0.25, vb.x + vb.w * 0.25);
  assert.equal(full.y + full.h * 0.75, vb.y + vb.h * 0.75);
});

test("zoomAt clamps to the full extent and to the max zoom", () => {
  assert.equal(zoomAt(full, 0.1, 0.5, 0.5, full).w, full.w);
  assert.equal(zoomAt(full, 1000, 0.5, 0.5, full, 10).w, 100);
});

test("panBy moves the view opposite to the drag and stays constrained", () => {
  const z = zoomAt(full, 4, 0.5, 0.5, full);
  const p = panBy(z, 50, 0, full);
  assert.equal(p.x, z.x - 50);
  const far = panBy(z, -1e9, -1e9, full);
  assert.ok(far.x <= full.x + full.w - far.w + far.w * 0.25 + 1e-9);
  assert.ok(far.y <= full.y + full.h - far.h + far.h * 0.25 + 1e-9);
});

test("constrain leaves an in-bounds view untouched", () => {
  const vb: ViewBox = { x: 100, y: 100, w: 500, h: 800 };
  assert.deepEqual(constrain(vb, full), vb);
});

test("fitAspect contains the whole extent at any aspect and centers it", () => {
  for (const aspect of [0.4, 0.625, 1, 2]) {
    const vb = fitAspect(full, aspect);
    assert.ok(Math.abs(vb.w / vb.h - aspect) < 1e-9);
    assert.ok(vb.x <= full.x + 1e-9 && vb.y <= full.y + 1e-9);
    assert.ok(vb.x + vb.w >= full.x + full.w - 1e-9 && vb.y + vb.h >= full.y + full.h - 1e-9);
    assert.ok(Math.abs(vb.x + vb.w / 2 - (full.x + full.w / 2)) < 1e-9);
  }
});

test("centeredOn and lerpBox", () => {
  const vb = centeredOn(500, 800, 200, full);
  assert.deepEqual([vb.x, vb.y, vb.w, vb.h], [400, 640, 200, 320]);
  assert.deepEqual(lerpBox(full, vb, 0), full);
  assert.deepEqual(lerpBox(full, vb, 1), vb);
});
