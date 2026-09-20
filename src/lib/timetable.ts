/**
 * Pure parsing of VT's public Timetable of Classes (Banner self-service, HZSKVTSC.P_ProcRequest).
 * The page exposes seat CAPACITY per section, not enrollment, and locations use building abbreviations
 * ("GBJ 104"). Nothing here touches the network; scripts/data/fetch-timetable.ts does the fetching.
 */

export type Weekday = "M" | "T" | "W" | "R" | "F";
const WEEKDAYS: readonly string[] = ["M", "T", "W", "R", "F"];

/** One weekly meeting of one section. Times are minutes after midnight (local Blacksburg time). */
export interface Meeting {
  crn: string;
  /** Building abbreviation as printed by the timetable, e.g. "GBJ". */
  building: string;
  days: Weekday[];
  startMin: number;
  endMin: number;
  /** Seat cap of the section (NOT enrollment). */
  capacity: number;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;?/gi, " ") // Banner often omits the semicolon
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();

/** "3:30PM" -> 930. Returns null for TBA/blank/anything else. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 1 || h > 12 || min > 59) return null;
  return ((h % 12) + (m[3]!.toUpperCase() === "P" ? 12 : 0)) * 60 + min;
}

/** "M W F" -> ["M","W","F"]. Unknown tokens (like "(ARR)" or "S") are dropped, so weekend-only rows come back empty. */
export function parseDays(text: string): Weekday[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((d): d is Weekday => WEEKDAYS.includes(d));
}

/** "GBJ 104" -> "GBJ". Online/arranged/blank locations return null. */
export function parseBuildingCode(loc: string): string | null {
  const first = loc.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (!/^[A-Z0-9]{2,8}$/.test(first)) return null;
  if (first === "ONLINE" || first === "ARR" || first === "TBA" || first === "NA") return null;
  return first;
}

function toMeeting(crn: string, capacity: number, daysTxt: string, begin: string, end: string, loc: string): Meeting | null {
  const days = parseDays(daysTxt);
  const startMin = parseClock(begin);
  const endMin = parseClock(end);
  const building = parseBuildingCode(loc);
  if (!days.length || startMin === null || endMin === null || endMin <= startMin || !building) return null;
  return { crn, building, days, startMin, endMin, capacity };
}

/** Every timed, in-person meeting on a timetable results page (main rows plus "Additional Times" rows). */
export function parseTimetableHtml(html: string): Meeting[] {
  const out: Meeting[] = [];
  let crn = "";
  let capacity = 0;
  // Banner leaves <tr> unclosed, so split on the opening tag.
  for (const chunk of html.split(/<tr\b[^>]*>/i).slice(1)) {
    const cells = [...chunk.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => decode(m[1]!));
    if (!cells.length) continue;
    if (/^\d{5}$/.test(cells[0]!) && cells.length >= 12) {
      crn = cells[0]!;
      capacity = Number.parseInt(cells[6]!, 10) || 0;
      const m = toMeeting(crn, capacity, cells[8]!, cells[9]!, cells[10]!, cells[11]!);
      if (m) out.push(m);
      continue;
    }
    const at = cells.findIndex((c) => /Additional Times/i.test(c));
    if (at >= 0 && crn && cells.length >= at + 5) {
      const m = toMeeting(crn, capacity, cells[at + 1]!, cells[at + 2]!, cells[at + 3]!, cells[at + 4]!);
      if (m) out.push(m);
    }
  }
  return out;
}

/** Subject codes from the search form's inline script: `new Option("AAD - Architecture...","AAD",...)`. "%" (All Subjects) is skipped. */
export function parseSubjects(formHtml: string): string[] {
  const codes = new Set<string>();
  for (const m of formHtml.matchAll(/new Option\("[^"]*","([A-Z0-9]{2,6})"/g)) codes.add(m[1]!);
  return [...codes];
}

/** Sum of seat capacity that STARTS at each building/day/start-time, used to keep the committed data file small. */
export interface MeetingGroup {
  building: string;
  days: Weekday[];
  startMin: number;
  endMin: number;
  capacity: number;
  sections: number;
}

export function groupMeetings(meetings: Meeting[]): MeetingGroup[] {
  const map = new Map<string, MeetingGroup>();
  for (const m of meetings) {
    const key = `${m.building}|${m.days.join("")}|${m.startMin}|${m.endMin}`;
    const g = map.get(key);
    if (g) {
      g.capacity += m.capacity;
      g.sections += 1;
    } else {
      map.set(key, { building: m.building, days: m.days, startMin: m.startMin, endMin: m.endMin, capacity: m.capacity, sections: 1 });
    }
  }
  return [...map.values()].sort((a, b) => a.building.localeCompare(b.building) || a.startMin - b.startMin || a.days.join("").localeCompare(b.days.join("")));
}
