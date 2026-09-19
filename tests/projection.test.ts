import { test } from "node:test";
import assert from "node:assert/strict";
import { footprintToPath, haversineMeters, makeProjector } from "../src/lib/projection.ts";
import { BUILDINGS } from "../src/data/index.ts";

const find = (name: string) => {
  const b = BUILDINGS.find((x) => x.name === name);
  assert.ok(b, `${name} missing from BUILDINGS`);
  return b;
};

test("origin projects to (0,0); north is up (negative y), east is right", () => {
  const p = makeProjector({ lat: 37.2, lon: -80.4 });
  assert.deepEqual(p(37.2, -80.4), { x: 0, y: -0 });
  assert.ok(p(37.201, -80.4).y < 0);
  assert.ok(p(37.2, -80.399).x > 0);
});

test("calibration: projected distance matches great-circle distance for real landmarks", () => {
  // Plan Phase 1 step 1: Burruss Hall <-> Lane Stadium.
  const a = find("Burruss Hall");
  const b = find("Lane Stadium");
  const project = makeProjector({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 });
  const pa = project(a.lat, a.lon);
  const pb = project(b.lat, b.lon);
  const planar = Math.hypot(pa.x - pb.x, pa.y - pb.y);
  const truth = haversineMeters(a, b);
  assert.ok(truth > 800 && truth < 1300, `unexpected landmark distance ${truth}`);
  assert.ok(Math.abs(planar - truth) / truth < 0.005, `planar ${planar} vs haversine ${truth}`);
});

test("calibration: Burruss is north-west of Lane Stadium, as on VT's real map", () => {
  const a = find("Burruss Hall");
  const b = find("Lane Stadium");
  const project = makeProjector(b);
  const p = project(a.lat, a.lon);
  assert.ok(p.x < 0 && p.y < 0);
});

test("footprintToPath emits one closed subpath per ring", () => {
  const project = makeProjector({ lat: 37, lon: -80 });
  const path = footprintToPath(
    [
      [[-80, 37], [-79.999, 37], [-79.999, 37.001]],
      [[-80, 37], [-80, 37.001], [-79.999, 37.001]],
    ],
    project,
  );
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.equal((path.match(/Z/g) ?? []).length, 2);
});
