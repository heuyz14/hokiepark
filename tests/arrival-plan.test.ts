import assert from "node:assert/strict";
import { test } from "node:test";
import { buildArrivalPlan } from "../src/lib/arrival-plan.ts";

test("arrival plan works backward from class time and labels heuristic parking time", () => {
  const plan = buildArrivalPlan({ destinationName: "Torgersen Hall", targetMinute: 14 * 60, recommendedLot: { id: "lot-demo", name: "Demo lot", walkMin: 6 } });
  assert.equal(plan.recommendedLotId, "lot-demo");
  assert.equal(plan.lotArrivalMinute, 825, "1:45 PM allows 4-minute parking, 6-minute walk, and 5-minute buffer");
  assert.deepEqual(plan.steps.map((step) => step.source), ["heuristic", "route", "user"]);
  assert.match(plan.assumptions.join(" "), /does not estimate driving/i);
});
