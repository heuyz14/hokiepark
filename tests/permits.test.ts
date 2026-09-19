import { test } from "node:test";
import assert from "node:assert/strict";
import { access, canPark, garageAccess, lotAccess, PERMITS, type PermitId } from "../src/lib/permits.ts";
import { LOTS } from "../src/data/lots.ts";
import { GARAGES } from "../src/data/garages.ts";

const verdict = (lotClass: Parameters<typeof canPark>[0], permit: PermitId) => canPark(lotClass, permit).verdict;

// --- The rules that keep a driver from being ticketed (2026-27 Parking Quick Guide) ---

test("Faculty/Staff may park in F/S, C/G and Resident areas", () => {
  assert.equal(verdict("fsv", "fs"), "yes");
  assert.equal(verdict("cg", "fs"), "yes");
  assert.equal(verdict("any-permit", "fs"), "yes");
  // "employees may also park in designated F/S 24-Hour spaces"
  assert.equal(verdict("fs-24", "fs"), "yes");
});

test("a Commuter/Graduate permit is NOT valid in Faculty/Staff lots", () => {
  assert.equal(verdict("fsv", "cg"), "no");
  assert.equal(verdict("fs-24", "cg"), "no");
  assert.equal(verdict("cg", "cg"), "yes");
});

test("C/G is not valid in Perry Street Garage unless the Perry permit was bought", () => {
  for (const section of ["perry-fs", "perry-cg"] as const) {
    const plain = canPark(section, "cg");
    assert.equal(plain.verdict, "no", `${section} must refuse a plain C/G permit`);
    assert.match(plain.note ?? "", /Perry Street permit/i);
  }
  // The Perry permit buys the C/G sections specifically - not the Faculty/Staff levels.
  assert.equal(verdict("perry-cg", "cg-perry"), "yes");
  assert.equal(verdict("perry-fs", "cg-perry"), "no");
  assert.equal(verdict("perry-fs", "fs"), "yes");
  assert.equal(verdict("perry-cg", "fs"), "yes");
});

test("Evening Only is valid in regular F/S but never in 24-hour spaces", () => {
  assert.equal(verdict("fsv", "evening"), "yes");
  assert.equal(verdict("fs-24", "evening"), "no");
});

test("Remote permits are valid only in their own lot", () => {
  assert.equal(verdict("fs-remote", "fs-remote"), "yes");
  assert.equal(verdict("fsv", "fs-remote"), "no");
  assert.equal(verdict("cg", "fs-remote"), "no");
  // "Any University Permit (Does not include Remote)"
  assert.equal(verdict("any-permit", "fs-remote"), "no");
  assert.equal(verdict("any-permit", "student-remote"), "no");
  assert.equal(verdict("student-remote", "student-remote"), "yes");
  assert.equal(verdict("student-remote", "cg"), "no");
});

test("Resident permits cover Resident areas, including Chicken Hill, but not F/S or C/G lots", () => {
  assert.equal(verdict("any-permit", "resident"), "yes");
  assert.equal(verdict("fs-remote", "resident"), "yes"); // "Chicken Hill Lot" is listed as Resident parking
  assert.equal(verdict("fsv", "resident"), "no");
  assert.equal(verdict("cg", "resident"), "no");
});

test("a visitor may use the V in F/S/V, and nothing else", () => {
  assert.equal(verdict("fsv", "visitor"), "yes");
  assert.equal(verdict("cg", "visitor"), "no");
  assert.equal(verdict("fs-24", "visitor"), "no");
  assert.equal(verdict("any-permit", "visitor"), "no");
});

test("graduate-only spaces are never a confident yes: the guide doesn't settle them", () => {
  assert.equal(verdict("graduate", "cg"), "check");
  assert.equal(verdict("graduate", "fs"), "check");
  assert.equal(verdict("graduate", "visitor"), "no");
});

test("ADA/Service spaces need credentials, whatever the permit", () => {
  for (const p of PERMITS) assert.equal(verdict("ada-service-24", p.id), "no");
  assert.equal(access(["ada-service-24"], ["cg"], { ada: true }).verdict, "yes");
  assert.equal(access(["ada-service-24"], ["cg"], { ada: false }).verdict, "no");
  assert.equal(access(["ada-service-24"], [], { ada: true }).verdict, "yes");
});

// --- Combining permits, lots and garages ---

test("the best verdict across held permits wins, with its own note", () => {
  const both = access(["fsv"], ["cg", "fs"]);
  assert.equal(both.verdict, "yes");
  assert.equal(both.note, undefined, "a yes must not carry a no's explanation");
  assert.equal(access(["fsv"], ["cg", "resident"]).verdict, "no");
});

test("a split lot is usable if either section allows it", () => {
  // Coliseum West is signed both F/S/V and C/G on VT's map.
  assert.equal(access(["fsv", "cg"], ["cg"]).verdict, "yes");
  assert.equal(access(["fsv", "cg"], ["fs"]).verdict, "yes");
  assert.equal(access(["fsv", "cg"], ["resident"]).verdict, "no");
});

test("no permits chosen = no judgement, just a prompt", () => {
  const none = access(["fsv"], []);
  assert.equal(none.verdict, "check");
  assert.match(none.note ?? "", /choose the permit/i);
});

test("an inferred lot class never returns a confident yes", () => {
  const inferred = { classes: ["fsv"] as const, needsConfirm: true };
  assert.equal(lotAccess({ classes: ["fsv"], needsConfirm: true }, ["fs"]).verdict, "check");
  assert.equal(lotAccess({ classes: ["fsv"], needsConfirm: false }, ["fs"]).verdict, "yes");
  // a "no" stays a "no": uncertainty never opens a lot up
  assert.equal(lotAccess({ classes: ["fsv"], needsConfirm: true }, ["cg"]).verdict, "no");
  assert.ok(inferred);
});

test("a garage is usable when any single level is", () => {
  const perry = GARAGES.find((g) => g.id === "perry-street")!;
  assert.equal(garageAccess(perry.levels, ["cg-perry"]).verdict, "yes", "Perry permit opens the C/G level");
  assert.equal(garageAccess(perry.levels, ["cg"]).verdict, "no", "a plain C/G permit opens no level of Perry");
  assert.equal(garageAccess(perry.levels, ["fs"]).verdict, "yes");
  // VT's map signs Perry for F/S + Perry permits only, with no visitor category.
  assert.equal(garageAccess(perry.levels, ["visitor"]).verdict, "check");

  const northEnd = GARAGES.find((g) => g.id === "north-end-center")!;
  assert.equal(garageAccess(northEnd.levels, ["visitor"]).verdict, "yes");
  assert.equal(garageAccess(northEnd.levels, ["cg"]).verdict, "no", "North End is F/S/V on VT's map");
});

// --- The real data, checked against the printed map ---

test("every lot carries at least one class, and inferred ones are flagged", () => {
  assert.equal(LOTS.length, 19);
  for (const l of LOTS) {
    assert.ok(l.classes.length >= 1, `${l.id} has no permit class`);
    assert.equal(typeof l.needsConfirm, "boolean");
  }
  // The four whose names aren't printed on VT's map.
  const inferred = LOTS.filter((l) => l.needsConfirm).map((l) => l.id).sort();
  assert.deepEqual(inferred, ["lot-bookstore", "lot-durham", "lot-pamplin", "lot-torgersen"]);
});

test("lots read off the map keep the category VT printed", () => {
  const classOf = (id: string) => LOTS.find((l) => l.id === id)!.classes;
  assert.deepEqual(classOf("lot-stadium"), ["any-permit"]); // dark maroon "Any University Permit"
  assert.deepEqual(classOf("lot-owens"), ["fs-24"]); // purple
  assert.deepEqual(classOf("lot-dietrick"), ["fs-24"]); // purple
  assert.deepEqual(classOf("lot-stanger-st-ada"), ["ada-service-24"]); // pink
  assert.deepEqual(classOf("lot-graduate-life-center-west"), ["graduate"]); // blue
  assert.deepEqual(classOf("lot-coliseum-west"), ["fsv", "cg"]); // both sections printed
  assert.deepEqual(classOf("lot-squires"), ["fsv"]); // orange
});

test("a commuter is refused the core F/S lots and offered the ones that are really theirs", () => {
  const forCommuter = LOTS.filter((l) => lotAccess(l, ["cg"]).verdict === "yes").map((l) => l.id);
  assert.ok(forCommuter.includes("lot-coliseum-west"), "Coliseum West has a C/G section");
  assert.ok(forCommuter.includes("lot-stadium"), "Stadium takes any university permit");
  for (const id of ["lot-squires", "lot-drillfield-north", "lot-owens", "lot-dietrick", "lot-ag-quad"]) {
    assert.equal(lotAccess(LOTS.find((l) => l.id === id)!, ["cg"]).verdict, "no", `${id} is F/S - a commuter would be ticketed`);
  }
});

test("ADA lots: the Stanger ADA lot opens only with credentials", () => {
  const stanger = LOTS.find((l) => l.id === "lot-stanger-st-ada")!;
  assert.equal(lotAccess(stanger, ["fs"], { ada: false }).verdict, "no");
  assert.equal(lotAccess(stanger, ["fs"], { ada: true }).verdict, "yes");
});
