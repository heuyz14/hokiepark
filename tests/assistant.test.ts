import { test } from "node:test";
import assert from "node:assert/strict";
import { answerQuestion, findPlace, localAnswerer, SUGGESTED_QUESTIONS } from "../src/lib/assistant.ts";
import { BUILDINGS, GARAGES, LOTS } from "../src/data/index.ts";
import { nearest } from "../src/lib/nearby.ts";
import { garageTotals } from "../src/lib/occupancy.ts";

const text = (q: string) => answerQuestion(q).lines.join("\n");

test("findPlace resolves the spec's named places", () => {
  assert.equal(findPlace("closest open parking to Squires Student Center")?.name, "Squires Student Center");
  assert.equal(findPlace("is there accessible parking near Cassell Coliseum")?.name, "Cassell Coliseum");
  assert.equal(findPlace("is perry street garage full")?.id, "perry-street");
  assert.equal(findPlace("which garage has the most open spots")?.id, undefined);
  assert.equal(findPlace("what is the meaning of life"), null, "a lone short word must not name a place");
  assert.equal(findPlace("is the squires lot full")?.kind, "lot");
});

test("ACCEPTANCE 1: closest open parking to Squires - nearest open garage numbers match the data", () => {
  const a = answerQuestion(SUGGESTED_QUESTIONS[0]!);
  const t = a.lines.join("\n");
  assert.match(a.lines[0]!, /Squires Student Center/);
  // Squires is in the east; North End Center is nearer than Perry among garages, whichever the data says:
  const named = GARAGES.filter((g) => t.includes(g.name));
  assert.ok(named.length >= 1, "names a garage");
  for (const g of named) assert.ok(t.includes(`${garageTotals(g).open} of ${garageTotals(g).capacity} open`), `${g.name} numbers must match data`);
  // the first lot listed must be the true nearest lot by footprint distance
  const sq = BUILDINGS.find((b) => b.name === "Squires Student Center")!;
  const [nearestLot] = nearest(LOTS, sq, 1);
  assert.ok(t.includes(`- ${nearestLot!.item.name} lot`), `expected nearest lot ${nearestLot!.item.name}`);
  assert.ok(a.refs.some((r) => r.kind === "lot" && r.id === nearestLot!.item.id));
});

test("ACCEPTANCE 2: accessible parking near Cassell Coliseum - names Coliseum West lot with its ADA count", () => {
  const a = answerQuestion(SUGGESTED_QUESTIONS[1]!);
  const t = a.lines.join("\n");
  const lot = LOTS.find((l) => l.id === "lot-coliseum-west")!;
  assert.match(t, /Coliseum West lot/);
  assert.ok(t.includes(`${lot.adaSpaces} designated accessible spaces`));
  assert.ok(a.refs.some((r) => r.id === "lot-coliseum-west"));
  // must be honest that lots have no live counts
  assert.match(t, /aren't tracked for lots/);
});

test("ACCEPTANCE 3: which garage has the most open spots - picks the true maximum and lists both", () => {
  const a = answerQuestion(SUGGESTED_QUESTIONS[2]!);
  const top = [...GARAGES].sort((x, y) => garageTotals(y).open - garageTotals(x).open)[0]!;
  const t = a.lines.join("\n");
  assert.ok(a.lines[0]!.startsWith(top.name), String(a.lines[0]));
  assert.ok(a.lines[0]!.includes(`${garageTotals(top).open} of ${garageTotals(top).capacity}`));
  for (const g of GARAGES) assert.ok(t.includes(`${g.name}: ${garageTotals(g).open} of ${garageTotals(g).capacity} open`));
});

test("garage status answer lists every level with the same counts the sheet shows", () => {
  const perry = GARAGES.find((g) => g.id === "perry-street")!;
  const t = text("is Perry Street Garage full?");
  for (const l of perry.levels) assert.ok(t.includes(l.label), `missing ${l.label}`);
  assert.match(t, /Level 1 - Commuter & graduate: 0 open of 120 \(Full\)/);
});

test("lot status answer includes permit and ADA flag", () => {
  // Permit wording now comes from VT's official map: Squires is signed Faculty/Staff/Visitor.
  assert.match(text("is the squires lot full?"), /Squires lot: Faculty\/Staff\/Visitor.*8 designated accessible spaces/);
  assert.match(text("tell me about Owens lot"), /no designated accessible spaces/);
});

test("ADA question without a place summarizes campus-wide", () => {
  const t = text("where is accessible parking?");
  assert.match(t, /Accessible parking on campus/);
  assert.ok(LOTS.filter((l) => l.hasADA).length >= 2);
});

test("visitor question and unknown question are handled", () => {
  assert.match(text("where can visitors park?"), /Visitor-friendly parking/);
  const help = answerQuestion("what is the meaning of life");
  assert.match(help.lines[0]!, /I can answer questions about/);
  assert.deepEqual(answerQuestion("   ").lines, help.lines);
});

test("localAnswerer is async and returns the same answer", async () => {
  assert.deepEqual(await localAnswerer(SUGGESTED_QUESTIONS[2]!), answerQuestion(SUGGESTED_QUESTIONS[2]!));
});

test("every answer ref points at a real item", () => {
  for (const q of [...SUGGESTED_QUESTIONS, "visitor parking", "is perry full", "accessible parking"]) {
    for (const r of answerQuestion(q).refs) {
      const pool = r.kind === "garage" ? GARAGES : LOTS;
      assert.ok(pool.some((x) => x.id === r.id), `${q}: bad ref ${r.id}`);
    }
  }
});
