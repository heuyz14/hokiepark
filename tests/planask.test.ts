import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_NAME, formatMinute, nowOf, parseDay, parseTime, planAnswer, withPlanAhead } from "../src/lib/planask.ts";

const now = { dow: 3, minute: 9 * 60 };

test("parseTime: am/pm, colon times, noon, and 'at N' class hours", () => {
  const cases: [string, number | null][] = [
    ["2pm", 840], ["2 PM", 840], ["2:30pm", 870], ["10 a.m.", 600], ["12pm", 720], ["12am", 0], ["11:45 am", 705],
    ["14:00", 840], ["9:15", 555], ["2:00", 840], ["noon", 720], ["at 2", 840], ["around 10", 600], ["by 8", 480], ["at 12", 720],
    ["no time here", null], ["building 153", null], ["25:00", null], ["13pm", null], ["in 20 minutes", null], ["at 20 min", null],
  ];
  for (const [text, want] of cases) assert.equal(parseTime(text), want, text);
});

test("parseDay: names, abbreviations, tomorrow, today", () => {
  assert.equal(parseDay("on Wednesday", 1), 3);
  assert.equal(parseDay("tues class", 1), 2);
  assert.equal(parseDay("thurs", 1), 4);
  assert.equal(parseDay("tomorrow", 3), 4);
  assert.equal(parseDay("tomorrow", 7), 1, "wraps Sunday to Monday");
  assert.equal(parseDay("today", 5), 5);
  assert.equal(parseDay("nothing", 5), null);
});

test("formatMinute and nowOf", () => {
  assert.equal(formatMinute(0), "12:00 AM");
  assert.equal(formatMinute(12 * 60), "12:00 PM");
  assert.equal(formatMinute(13 * 60 + 5), "1:05 PM");
  assert.deepEqual(nowOf(new Date(2026, 8, 20, 9, 30)), { dow: 7, minute: 570 }, "Sunday is 7");
  assert.equal(DAY_NAME[3], "Wednesday");
});

test("a building plus a time plans; missing either falls through", () => {
  const a = planAnswer("I have a 2pm class in Hancock Hall, commuter permit, where should I park?", {}, now);
  assert.ok(a);
  assert.match(a.lines[0]!, /2:00 PM Wednesday class at Hancock Hall \(arriving about 1:45 PM\), Commuter\/Graduate/);
  assert.ok(a.lines.some((l) => /^- 1\. /.test(l)));
  assert.ok(a.lines.some((l) => /SIMULATED/.test(l)) && a.lines.some((l) => /posted signage/i.test(l)));
  assert.ok(a.refs.length >= 1);
  assert.equal(planAnswer("where is Hancock Hall?", {}, now), null, "no time -> not a plan question");
  assert.equal(planAnswer("parking at 2pm", {}, now), null, "no building -> not a plan question");
  assert.equal(planAnswer("what's open at Perry Street Garage at 2pm", {}, now), null, "a garage is not a destination building");
});

test("a timetable building abbreviation identifies the destination", () => {
  const answer = planAnswer("2pm class at torg, commuter permit", {}, now)!;
  assert.match(answer.lines[0]!, /class at Torgersen Hall/);
});

test("the permit in the sentence overrides the saved one; with neither it asks", () => {
  const saved = planAnswer("2pm class at Hancock Hall", { permits: ["fs"] }, now)!;
  assert.match(saved.lines[0]!, /Faculty\/Staff/);
  const said = planAnswer("2pm class at Hancock Hall, visitor", { permits: ["fs"] }, now)!;
  assert.match(said.lines[0]!, /Visitor/);
  const none = planAnswer("2pm class at Hancock Hall", {}, now)!;
  assert.match(none.lines[0]!, /I need your permit/);
  assert.deepEqual(none.refs, []);
});

test("day handling: named day, tomorrow, and a weekend replays Wednesday", () => {
  assert.match(planAnswer("2pm on friday at Hancock Hall commuter", {}, now)!.lines[0]!, /Friday/);
  assert.match(planAnswer("2pm tomorrow at Hancock Hall commuter", { permits: ["cg"] }, now)!.lines[0]!, /Thursday/);
  const sat = planAnswer("2pm class at Hancock Hall commuter", {}, { dow: 6, minute: 600 })!;
  assert.ok(sat.lines.some((l) => /Weekends have no classes/.test(l)));
});

test("withPlanAhead answers plan questions itself and passes everything else through", async () => {
  const calls: string[] = [];
  const fallback = async (q: string) => (calls.push(q), { lines: ["fallback"], refs: [] });
  const ask = withPlanAhead(fallback, () => ({ permits: ["cg"] }), () => now);
  assert.match((await ask("2pm class at Hancock Hall"))!.lines[0]!, /Hancock Hall/);
  assert.deepEqual(calls, []);
  assert.deepEqual((await ask("which garage has the most open spots"))!.lines, ["fallback"]);
  assert.equal(calls.length, 1);
});
