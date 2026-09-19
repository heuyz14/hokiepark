import { test } from "node:test";
import assert from "node:assert/strict";
import { answerQuestion, detectPermits, findPlace, makeLocalAnswerer, SUGGESTED_QUESTIONS } from "../src/lib/assistant.ts";
import { GARAGES, LOTS } from "../src/data/index.ts";
import { access, garageAccess, lotAccess, PERMIT_LABEL, SIGNAGE_NOTE, VERDICT_LABEL, type PermitId } from "../src/lib/permits.ts";
import { garageTotals, openSpaces } from "../src/lib/occupancy.ts";

const text = (q: string, ctx = {}) => answerQuestion(q, ctx).lines.join("\n");
const PERMITS: PermitId[] = ["cg", "fs", "visitor", "resident"];
const usable = (g: (typeof GARAGES)[number], p: PermitId[]) => g.levels.filter((l) => lotAccess({ classes: l.classes }, p).verdict === "yes").reduce((n, l) => n + openSpaces(l), 0);

test("nothing held => answers are byte-identical to the original assistant (spec questions untouched)", () => {
  for (const q of [...SUGGESTED_QUESTIONS, "is perry street garage full?", "where can visitors park?".replace("visitors", "people")]) {
    assert.deepEqual(answerQuestion(q, { permits: [], ada: false }), answerQuestion(q));
    assert.deepEqual(answerQuestion(q, {}), answerQuestion(q));
  }
});

test("detectPermits reads common phrasings; a place name like 'Graduate Life Center' is NOT a permit", () => {
  assert.deepEqual(detectPermits("i have a commuter permit"), ["cg"]);
  assert.deepEqual(detectPermits("c g permit"), ["cg"]);
  assert.deepEqual(detectPermits("perry street permit"), ["cg-perry"]);
  assert.deepEqual(detectPermits("faculty parking"), ["fs"]);
  assert.deepEqual(detectPermits("where do residents park"), ["resident"]);
  assert.deepEqual(detectPermits("visitors"), ["visitor"]);
  assert.deepEqual(detectPermits("closest parking to graduate life center west"), []);
  assert.deepEqual(detectPermits("which garage has the most open spots"), []);
});

test("lot answers show exactly the verdict lib/permits gives, for every lot the assistant can resolve", () => {
  let tested = 0;
  for (const l of LOTS) {
    const q = `tell me about ${l.name} lot`;
    if (findPlace(q)?.id !== l.id) continue;
    for (const p of PERMITS) {
      const v = lotAccess(l, [p], { ada: false }).verdict;
      assert.ok(text(q, { permits: [p] }).includes(`Your permit: ${VERDICT_LABEL[v]}`), `${l.name} / ${p}: expected "${VERDICT_LABEL[v]}"`);
      tested++;
    }
  }
  assert.ok(tested >= 40, `only ${tested} lot/permit pairs were checked`);
});

test("HONESTY: a lot whose permit type was only inferred is never described as a confident yes", () => {
  const inferred = LOTS.filter((l) => l.needsConfirm);
  assert.ok(inferred.length > 0, "demo data should contain at least one inferred lot");
  let pairs = 0;
  for (const l of inferred) for (const p of PERMITS) {
    if (access(l.classes, [p]).verdict !== "yes") continue; // only where the raw class would say yes
    pairs++;
    const t = text(`tell me about ${l.name} lot`, { permits: [p] });
    if (findPlace(`tell me about ${l.name} lot`)?.id !== l.id) continue;
    assert.ok(!t.includes(VERDICT_LABEL.yes), `${l.name}/${p} must not say "${VERDICT_LABEL.yes}"`);
    assert.ok(t.includes(VERDICT_LABEL.check));
  }
  assert.ok(pairs > 0);
});

test("nearest parking for a held permit: never suggests a 'no' lot, and garage numbers match the rules", () => {
  for (const p of PERMITS) {
    const a = answerQuestion("Where's the closest open parking to Newman Library?", { permits: [p] });
    const t = a.lines.join("\n");
    assert.match(a.lines[0]!, new RegExp(`for ${PERMIT_LABEL[p].replace("/", "\\/")}`));
    assert.ok(t.includes(SIGNAGE_NOTE), "signage disclaimer present");
    for (const r of a.refs.filter((x) => x.kind === "lot")) {
      const lot = LOTS.find((x) => x.id === r.id)!;
      assert.notEqual(lotAccess(lot, [p]).verdict, "no", `${lot.name} suggested to a ${p} holder but the rules say no`);
    }
    for (const g of GARAGES) {
      const line = a.lines.find((l) => l.startsWith(`- ${g.name}`));
      assert.ok(line, `${g.name} should be mentioned (${p})`);
      const totals = garageTotals(g);
      if (usable(g, [p]) > 0) {
        // UNCONDITIONAL: a garage with usable spaces must be reported with its real numbers, never as "no open spaces".
        assert.ok(line!.includes(`${usable(g, [p])} open on levels your permit covers (${totals.open} of ${totals.capacity} open overall)`), `${g.name}/${p}: ${line}`);
      } else if (garageAccess(g.levels, [p]).verdict === "no") assert.match(line!, /not valid for your permit/);
      else if (garageAccess(g.levels, [p]).verdict === "check") assert.match(line!, /check the posted sign/);
      else assert.match(line!, /no open spaces on levels your permit covers/);
    }
  }
});

test("REGRESSION: with several permits, EVERY garage that has usable spaces is reported with its numbers", () => {
  for (const set of [["cg", "fs"], ["fs", "visitor"], ["cg", "cg-perry", "fs"]] as PermitId[][]) {
    const lines = answerQuestion("closest parking to Newman Library", { permits: set }).lines;
    for (const g of GARAGES) {
      const u = usable(g, set);
      const line = lines.find((l) => l.startsWith(`- ${g.name}`))!;
      assert.ok(line, `${g.name} missing for ${set}`);
      if (u > 0) assert.ok(line.includes(`${u} open on levels your permit covers`), `${set}: ${line}`);
      else assert.doesNotMatch(line, /open on levels your permit covers \(/);
    }
  }
});

test("garage status with a permit: every level line says whether it is valid, matching the rules", () => {
  for (const p of PERMITS) {
    const perry = GARAGES.find((g) => g.id === "perry-street")!;
    const lines = answerQuestion("is perry street garage full?", { permits: [p] }).lines;
    for (const l of perry.levels) {
      const line = lines.find((x) => x.startsWith(`- ${l.label}:`))!;
      const v = lotAccess({ classes: l.classes }, [p]).verdict;
      assert.ok(line.endsWith({ yes: "valid for your permit", no: "not valid for your permit", check: "check the sign" }[v]), line);
    }
  }
});

test("a permit named in the question beats the saved one", () => {
  const t = answerQuestion("closest parking for commuters near Newman Library", { permits: ["fs"] }).lines[0]!;
  assert.match(t, /Commuter\/Graduate/);
  assert.doesNotMatch(t, /Faculty\/Staff/);
});

test("most-open ranks by spaces on levels the permit can use, and states when there are none", () => {
  for (const p of PERMITS) {
    const a = answerQuestion("which garage has the most open spots?", { permits: [p] });
    const best = Math.max(...GARAGES.map((g) => usable(g, [p])));
    if (best === 0) assert.match(a.lines[0]!, /Neither garage has open spaces/);
    else {
      const top = [...GARAGES].sort((x, y) => usable(y, [p]) - usable(x, [p]))[0]!;
      assert.ok(a.lines[0]!.startsWith(`${top.name} has the most open spaces on levels your permit covers: ${best}`), String(a.lines[0]));
    }
  }
});

test("accessible questions: default unchanged; with a permit held they add the placard requirement", () => {
  const q = "is there accessible parking near Cassell Coliseum?";
  assert.deepEqual(answerQuestion(q), answerQuestion(q, { permits: [], ada: false }));
  assert.match(text(q, { permits: ["cg"] }), /haven't marked that you have one/);
  assert.doesNotMatch(text(q, { permits: ["cg"], ada: true }), /haven't marked/);
});

test("permit-only questions list what the rules call valid, flag the rest, and every ref is real", () => {
  const t = text("where can commuters park?");
  assert.match(t, /Parking for a Commuter\/Graduate permit:/);
  for (const l of LOTS.filter((x) => lotAccess(x, ["cg"]).verdict === "yes")) assert.ok(t.includes(`- ${l.name} lot`), `${l.name} should be listed`);
  for (const l of LOTS.filter((x) => lotAccess(x, ["cg"]).verdict === "no")) assert.ok(!t.includes(`- ${l.name} lot`), `${l.name} must not be listed`);
  for (const q of ["where can commuters park?", "where can visitors park?", "faculty parking", "closest parking to Newman Library"]) {
    for (const r of answerQuestion(q, { permits: ["fs"] }).refs) {
      const pool = r.kind === "garage" ? GARAGES : LOTS;
      assert.ok(pool.some((x) => x.id === r.id), `${q}: bad ref ${r.id}`);
    }
  }
});

test("makeLocalAnswerer reads the driver's permits at ask time", async () => {
  let ctx: { permits: PermitId[]; ada: boolean } = { permits: [], ada: false };
  const ask = makeLocalAnswerer(() => ctx);
  const before = (await ask("closest parking to Newman Library")).lines[0]!;
  ctx = { permits: ["cg"], ada: false };
  const after = (await ask("closest parking to Newman Library")).lines[0]!;
  assert.equal(before, "Closest parking to Newman Library:");
  assert.match(after, /Closest parking for Commuter\/Graduate to Newman Library/);
});

test("a place whose NAME contains 'ADA' is answered as that place, not as a generic accessible-parking question", () => {
  const t = text("tell me about Stanger St. ADA lot", { permits: ["cg"] });
  assert.match(t, /^Stanger St\. ADA lot:/);
  assert.match(t, /Your permit:/);
  assert.match(text("is there accessible parking near Stanger St. ADA lot"), /^Accessible parking near/);
});
