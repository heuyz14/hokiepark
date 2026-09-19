import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPermit, eligibleStatus, eligibleLevels, eligibleOpen, levelAllows, levelPermits, lotAllows, lotDimmed, parsePermitChoice, PERMIT_CHOICES } from "../src/lib/permits.ts";
import { answerQuestion, makeLocalAnswerer, SUGGESTED_QUESTIONS } from "../src/lib/assistant.ts";
import { GARAGES, LOTS } from "../src/data/index.ts";
import { garageTotals, openAdaSpaces, openSpaces } from "../src/lib/occupancy.ts";

const garage = (id: string) => GARAGES.find((g) => g.id === id)!;

test("parsePermitChoice accepts only known values (untrusted input from storage/select)", () => {
  for (const p of PERMIT_CHOICES) assert.equal(parsePermitChoice(p), p);
  for (const bad of [null, undefined, "", "admin", "COMMUTER", 3, {}, "commuter "]) assert.equal(parsePermitChoice(bad), null);
});

test("garage level labels map to the permits they accept", () => {
  assert.deepEqual(levelPermits({ label: "Level 1 - Commuter & graduate" }), ["commuter"]);
  assert.deepEqual(levelPermits({ label: "Level 2 - Faculty, staff & visitor" }), ["faculty", "visitor"]);
  assert.deepEqual(levelPermits({ label: "Level 4 - Faculty & staff" }), ["faculty"]);
  assert.deepEqual(levelPermits({ label: "Level 9" }), PERMIT_CHOICES, "an unlabeled level is unrestricted");
});

test("lots: exact permit match, Mixed accepts everyone", () => {
  const coliseum = LOTS.find((l) => l.id === "lot-coliseum-west")!; // Commuter
  const squires = LOTS.find((l) => l.id === "lot-squires")!; // Mixed
  assert.ok(lotAllows(coliseum, "commuter") && !lotAllows(coliseum, "faculty"));
  for (const p of PERMIT_CHOICES) assert.ok(lotAllows(squires, p));
});

test("ADA lots are NEVER dimmed by permit; other ineligible lots are", () => {
  for (const p of PERMIT_CHOICES) for (const l of LOTS.filter((x) => x.hasADA)) assert.equal(lotDimmed(l, p), false, `${l.name} ADA lot dimmed for ${p}`);
  const owens = LOTS.find((l) => l.id === "lot-owens")!; // Resident, no ADA
  assert.equal(lotDimmed(owens, "commuter"), true);
  assert.equal(lotDimmed(owens, "resident"), false);
  assert.equal(lotDimmed(owens, null), false, "no permit chosen => nothing dimmed");
});

test("eligibleOpen sums only allowed levels, and never touches ADA counts", () => {
  for (const g of GARAGES) for (const p of PERMIT_CHOICES) {
    const expected = g.levels.filter((l) => levelAllows(l, p)).reduce((n, l) => n + openSpaces(l), 0);
    assert.equal(eligibleOpen(g, p), expected);
    assert.ok(eligibleOpen(g, p) <= garageTotals(g).open);
  }
  // Demo data facts worth pinning: Perry's only commuter level (L1) is full; residents have no garage levels.
  assert.equal(eligibleOpen(garage("perry-street"), "commuter"), 0);
  assert.equal(eligibleLevels(garage("perry-street"), "resident").length, 0);
  assert.ok(garage("north-end-center").levels.some((l) => openAdaSpaces(l) > 0));
});

test("detectPermit reads common phrasings and ignores unrelated text", () => {
  assert.equal(detectPermit("i have a commuter permit"), "commuter");
  assert.equal(detectPermit("where do residents park"), "resident");
  assert.equal(detectPermit("faculty parking near burruss"), "faculty");
  assert.equal(detectPermit("where can visitors park"), "visitor");
  assert.equal(detectPermit("which garage has the most open spots"), null);
  assert.equal(detectPermit("residential halls"), null, "'residential' is not 'resident'");
});

test("assistant: no permit => answers are byte-identical to before (spec questions untouched)", () => {
  for (const q of SUGGESTED_QUESTIONS) assert.deepEqual(answerQuestion(q, { permit: null }), answerQuestion(q));
});

test("assistant: a chosen permit restricts nearest-parking to eligible levels/lots with matching numbers", () => {
  const a = answerQuestion("Where's the closest open parking to Newman Library?", { permit: "commuter" });
  const t = a.lines.join("\n");
  assert.match(a.lines[0]!, /for a Commuter permit/);
  const nec = garage("north-end-center");
  assert.ok(t.includes(`${nec.name}: ${eligibleOpen(nec, "commuter")} open on levels for a Commuter permit (${garageTotals(nec).open} of ${garageTotals(nec).capacity} open overall)`), t);
  assert.match(t, /Perry Street Garage has no open spaces for a Commuter permit/);
  const lotLines = a.lines.filter((l) => / lot \(/.test(l));
  assert.ok(lotLines.length > 0);
  for (const l of lotLines) {
    const lot = LOTS.find((x) => l.startsWith(`- ${x.name} lot (`))!;
    assert.ok(lotAllows(lot, "commuter") || lot.hasADA, `${lot.name} should not be suggested to a commuter`);
  }
});

test("assistant: a permit named in the question beats the UI-selected one; residents get an honest empty garage answer", () => {
  const a = answerQuestion("closest parking to Newman Library for faculty", { permit: "commuter" });
  assert.match(a.lines[0]!, /Faculty\/Staff permit/);
  const r = answerQuestion("closest parking to Newman Library", { permit: "resident" }).lines.join("\n");
  assert.match(r, /has no levels for a Resident permit/);
});

test("assistant: most-open ranks by eligible spaces when a permit applies; ADA answers ignore permit", () => {
  const a = answerQuestion("which garage has the most open spots?", { permit: "commuter" });
  assert.match(a.lines[0]!, /^North End Center Garage has the most open spaces for a Commuter permit right now: \d+/);
  assert.deepEqual(answerQuestion("is there accessible parking near Cassell Coliseum?", { permit: "resident" }), answerQuestion("is there accessible parking near Cassell Coliseum?"));
});

test("assistant: permit-only question lists that permit's lots and levels; makeLocalAnswerer reads the permit lazily", async () => {
  assert.match(answerQuestion("where can commuters park?").lines[0]!, /Parking for a Commuter permit/);
  let current: "commuter" | null = null;
  const ask = makeLocalAnswerer(() => current);
  const before = (await ask("closest parking to Newman Library")).lines[0]!;
  current = "commuter";
  const after = (await ask("closest parking to Newman Library")).lines[0]!;
  assert.doesNotMatch(before, /permit/);
  assert.match(after, /Commuter permit/);
});

test("eligibleStatus reflects the permit's own levels: Perry is Full for commuters even though the garage overall is Open", () => {
  assert.equal(eligibleStatus(garage("perry-street"), "commuter"), "full");
  assert.equal(eligibleStatus(garage("perry-street"), "resident"), "full", "no eligible levels reads as Full");
  assert.notEqual(eligibleStatus(garage("north-end-center"), "commuter"), "full");
});
