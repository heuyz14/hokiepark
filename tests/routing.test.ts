import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateWalkRoute, findNearestWalkNode, type WalkGraph } from "../src/lib/routing.ts";

const graph: WalkGraph = {
  nodes: {
    a: { id: "a", lat: 37, lon: -80 },
    b: { id: "b", lat: 37, lon: -79.999 },
    c: { id: "c", lat: 37, lon: -79.998 },
  },
  adjacency: {
    a: [{ from: "a", to: "b", distanceMeters: 100 }],
    b: [{ from: "b", to: "c", distanceMeters: 100 }],
    c: [],
  },
};

test("walking route uses the shortest graph path and calculates ETA at 1.3 m/s", () => {
  const route = calculateWalkRoute(graph.nodes.a!, graph.nodes.c!, graph);
  assert.ok(route);
  assert.equal(route.distanceMeters, 200);
  assert.equal(route.durationSeconds, Math.round(200 / 1.3));
  assert.deepEqual(route.geometry, [graph.nodes.a, graph.nodes.b, graph.nodes.c]);
});

test("nearest walk node selects the closest node", () => {
  assert.equal(findNearestWalkNode({ lat: 37, lon: -79.9991 }, graph).id, "b");
});
