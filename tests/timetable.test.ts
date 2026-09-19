import { test } from "node:test";
import assert from "node:assert/strict";
import { groupMeetings, parseBuildingCode, parseClock, parseDays, parseSubjects, parseTimetableHtml } from "../src/lib/timetable.ts";

test("parseClock handles 12-hour times and rejects TBA", () => {
  assert.equal(parseClock("3:30PM"), 15 * 60 + 30);
  assert.equal(parseClock("12:05PM"), 12 * 60 + 5);
  assert.equal(parseClock("12:00AM"), 0);
  assert.equal(parseClock("8:00AM"), 8 * 60);
  for (const bad of ["TBA", "", "25:00PM", "3:75PM", "15:30"]) assert.equal(parseClock(bad), null, bad);
});

test("parseDays keeps Mon-Fri only", () => {
  assert.deepEqual(parseDays("M W F"), ["M", "W", "F"]);
  assert.deepEqual(parseDays("T R     "), ["T", "R"]);
  assert.deepEqual(parseDays("(ARR)"), []);
  assert.deepEqual(parseDays("S"), [], "weekend-only meetings are not weekday demand");
});

test("parseBuildingCode takes the first token and drops online/arranged locations", () => {
  assert.equal(parseBuildingCode("GBJ 104"), "GBJ");
  assert.equal(parseBuildingCode("SURGE 104C"), "SURGE");
  for (const loc of ["", "ONLINE", "ARR", "TBA", "N/A"]) assert.equal(parseBuildingCode(loc), null, loc);
});

const row = (cells: string[]) => `<tr>\n${cells.map((c) => `<td class=x>${c}</td>`).join("\n")}\n`; // no </tr>, like Banner
const main = (crn: string, cap: string, days: string, b: string, e: string, loc: string) =>
  row([`<A HREF=x><b>${crn}</b></A>&nbsp`, "CS-1014", "Title", "L", "Face-to-Face Instruction", "3", cap, "N/A", days, b, e, loc, "15T"]);

test("parseTimetableHtml reads main rows, Additional Times rows, and skips untimed/online rows", () => {
  const html = [
    "<table>",
    row(["CRN", "Course", "Title"]), // header
    main("83496", "40", "T R     ", "3:30PM", "4:45PM", "GBJ 104"),
    row(["<b>Comments for CRN 83496:</b>", "some comment"]),
    main("83502", "25", "M W", "9:00AM", "10:15AM", "MCB 100"),
    row(["&nbsp;", "&nbsp;", "&nbsp;", "&nbsp;", "<b>* Additional Times *</b>", "T ", "2:00PM", "4:30PM", "MCB 238", "&nbsp;"]),
    main("90001", "30", "(ARR)", "TBA", "TBA", "ONLINE"),
    main("90002", "10", "F", "1:00PM", "12:00PM", "GBJ 1"), // ends before it starts -> dropped
    "</table>",
  ].join("\n");
  const m = parseTimetableHtml(html);
  assert.deepEqual(
    m.map((x) => [x.crn, x.building, x.days.join(""), x.startMin, x.endMin, x.capacity]),
    [
      ["83496", "GBJ", "TR", 930, 1005, 40],
      ["83502", "MCB", "MW", 540, 615, 25],
      ["83502", "MCB", "T", 840, 990, 25], // additional meeting inherits the section's capacity
    ],
  );
});

test("parseSubjects reads codes from the form script and skips 'All Subjects'", () => {
  const html = `document.ttform.subj_code.options[0]=new Option("All Subjects","%",false, false);
    document.ttform.subj_code.options[1]=new Option("AAD - Architecture, Arts, and Design","AAD",false, false);
    document.ttform.subj_code.options[2]=new Option("CS - Computer Science","CS",false, false);
    document.ttform.subj_code.options[3]=new Option("CS - Computer Science","CS",false, false);`;
  assert.deepEqual(parseSubjects(html), ["AAD", "CS"]);
});

test("groupMeetings sums capacity of identical building/day/time slots", () => {
  const mk = (crn: string, capacity: number) => ({ crn, building: "MCB", days: ["M" as const], startMin: 540, endMin: 590, capacity });
  const g = groupMeetings([mk("1", 20), mk("2", 30), { ...mk("3", 5), startMin: 600, endMin: 650 }]);
  assert.equal(g.length, 2);
  assert.deepEqual([g[0]!.capacity, g[0]!.sections], [50, 2]);
});
