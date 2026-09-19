import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineMeters } from "../src/lib/nearby.ts";
import { BUILDINGS } from "../src/data/index.ts";

const find = (name: string) => {
  const b = BUILDINGS.find((x) => x.name === name);
  assert.ok(b, `${name} missing from BUILDINGS`);
  return b!;
};

test("haversineMeters: a point to itself is 0", () => {
  assert.equal(haversineMeters({ lat: 37.23, lon: -80.42 }, { lat: 37.23, lon: -80.42 }), 0);
});

test("haversineMeters: Burruss Hall to Lane Stadium is a plausible walking distance", () => {
  const truth = haversineMeters(find("Burruss Hall"), find("Lane Stadium"));
  assert.ok(truth > 800 && truth < 1300, `unexpected landmark distance ${truth}`);
});
