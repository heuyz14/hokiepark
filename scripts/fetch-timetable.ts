/**
 * One-time pull of VT's public Timetable of Classes (Blacksburg, one term) into data/raw/timetable.json.
 * Run: node scripts/fetch-timetable.ts [termyear=202609]
 * Politeness: one request per subject, ~1 s apart, User-Agent says who we are. Do this once, not per demo.
 * The page gives seat CAPACITY per section (not enrollment) and building ABBREVIATIONS (see src/data/building-codes.ts).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { groupMeetings, parseSubjects, parseTimetableHtml, type Meeting } from "../src/lib/timetable.ts";

const BASE = "https://selfservice.banner.vt.edu/ssb/HZSKVTSC.P_ProcRequest";
const TERM = process.argv[2] ?? "202609";
const UA = "HokiePark-VTHacks14 (student hackathon project; one-time timetable pull)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(subject: string): Promise<string> {
  const body = new URLSearchParams({
    CAMPUS: "0", TERMYEAR: TERM, CORE_CODE: "AR%", SUBJ_CODE: subject, SCHDTYPE: "%", CRSE_NUMBER: "", crn: "",
    open_only: "", disp_comments_in: "N", sess_code: "%", BTN_PRESSED: "FIND class sections", inst_name: "",
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(BASE, { method: "POST", body, headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${subject}: ${(err as Error).message}`);
      await sleep(2000 * attempt);
    }
  }
}

const form = await (await fetch(BASE, { headers: { "User-Agent": UA } })).text();
const subjects = parseSubjects(form);
if (subjects.length < 50) throw new Error(`Only found ${subjects.length} subjects - did the form change?`);
console.log(`term ${TERM}: ${subjects.length} subjects`);

const meetings: Meeting[] = [];
for (const [i, s] of subjects.entries()) {
  const found = parseTimetableHtml(await post(s));
  meetings.push(...found);
  console.log(`${String(i + 1).padStart(3)}/${subjects.length} ${s.padEnd(5)} ${found.length} meetings`);
  await sleep(1000);
}

const groups = groupMeetings(meetings);
mkdirSync(new URL("../data/raw/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../data/raw/timetable.json", import.meta.url),
  JSON.stringify({ term: TERM, campus: "Blacksburg", fetchedAt: new Date().toISOString(), note: "capacity = seat cap, NOT enrollment", meetings: groups }) + "\n",
);
console.log(`wrote data/raw/timetable.json: ${meetings.length} meetings -> ${groups.length} groups, ${new Set(meetings.map((m) => m.building)).size} building codes`);
