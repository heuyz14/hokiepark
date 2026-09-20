import { GARAGES, LOTS } from "../data/index.ts";
import { detectPermits, findPlace, type Answer, type AnswerContext, type AnswerRef, type Answerer } from "./assistant.ts";
import { formatMeters } from "./nearby.ts";
import { forecastSource, planAhead, type PlanOption } from "./planahead.ts";
import { PERMIT_LABEL, SIGNAGE_NOTE, type PermitId } from "./permits.ts";

/**
 * Rule-based reading of "I have a 2pm class in Hancock, commuter permit - where do I park?". No language model: a building
 * name (via the assistant's own place matching) plus a time is what triggers it; everything else falls through to the normal
 * assistant. Numbers come from `planAhead`, never from text.
 */

const DAY_WORDS: [RegExp, number][] = [
  [/\bmon(?:day)?\b/, 1], [/\btue(?:s(?:day)?)?\b/, 2], [/\bwed(?:nesday)?\b/, 3], [/\bthu(?:r(?:s(?:day)?)?)?\b/, 4],
  [/\bfri(?:day)?\b/, 5], [/\bsat(?:urday)?\b/, 6], [/\bsun(?:day)?\b/, 7],
];
export const DAY_NAME = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** A bare class hour with no am/pm: 7-11 are mornings, 12 is noon, 1-6 are afternoons. */
const classHour = (h: number) => (h >= 1 && h <= 6 ? h + 12 : h);

/** Minute of the day named in the text, or null. "2pm", "2:30 pm", "14:00", "noon", "at 2". */
export function parseTime(text: string): number | null {
  const t = text.toLowerCase();
  if (/\bnoon\b/.test(t)) return 720;
  let m = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/.exec(t);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (h < 1 || h > 12 || min > 59) return null;
    return ((h % 12) + (m[3]!.startsWith("p") ? 12 : 0)) * 60 + min;
  }
  m = /\b(\d{1,2}):(\d{2})\b/.exec(t);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return (h >= 13 || h === 0 ? h : classHour(h)) * 60 + min;
  }
  m = /(?:\bat|\baround|\bby|@)\s*(\d{1,2})(?![\d:]|\s*(?:min|minutes|mins|m\b|st|nd|rd|th))/.exec(t);
  if (m) {
    const h = Number(m[1]);
    if (h >= 1 && h <= 23) return classHour(h) * 60;
  }
  return null;
}

/** ISO weekday (1-7) named in the text ("wednesday", "tomorrow", "today"), or null when none is given. */
export function parseDay(text: string, todayDow: number): number | null {
  const t = text.toLowerCase();
  for (const [re, d] of DAY_WORDS) if (re.test(t)) return d;
  if (/\btomorrow\b/.test(t)) return (todayDow % 7) + 1;
  if (/\b(today|tonight)\b/.test(t)) return todayDow;
  return null;
}

export interface Now {
  dow: number;
  minute: number;
}

export const nowOf = (d: Date = new Date()): Now => ({ dow: d.getDay() === 0 ? 7 : d.getDay(), minute: d.getHours() * 60 + d.getMinutes() });

export function formatMinute(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const ref = (o: PlanOption): AnswerRef => ({ kind: o.kind, id: o.id, label: o.name });

const optionLine = (o: PlanOption, n?: number): string => {
  const head = `${n ? `${n}. ` : ""}${o.name}`;
  const where = `${formatMeters(o.meters)}, about ${o.walkMin} min walk`;
  const level = o.bestLevel ? ` Most room: ${o.bestLevel.label} (about ${o.bestLevel.predictedOpen} of ${o.bestLevel.capacity}).` : "";
  if (o.verdict !== "yes") return `- ${head}: ${where}. ${o.note ?? "Check the posted sign."}`;
  return `- ${head}: ${o.label} - forecast about ${o.predictedOpen} of ${o.capacity} open (${o.predictedPct}% full), ${where}.${level}`;
};

/** An answer when the question names a building and a time, else null so the normal assistant can respond. */
export function planAnswer(question: string, ctx: AnswerContext, now: Now): Answer | null {
  const minute = parseTime(question);
  if (minute === null) return null;
  const place = findPlace(question);
  if (!place || place.kind !== "building") return null;

  const dow = parseDay(question, now.dow) ?? now.dow;
  const normalized = question.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const named = detectPermits(normalized);
  const permits: PermitId[] = named.length ? named : (ctx.permits ?? []);
  const ada = ctx.ada === true;
  const when = `${formatMinute(minute)} ${DAY_NAME[dow] ?? ""}`.trim();

  if (!permits.length && !ada) {
    return {
      lines: [
        `To plan parking for ${place.name} at ${when} I need your permit.`,
        "Say it in your question (for example \"commuter\", \"faculty\" or \"visitor\") or choose it with \"Set your permit\" on the Map tab or the Plan tab.",
      ],
      refs: [],
    };
  }

  const r = planAhead({ building: place, dow, minute, permits, ada }, { garages: GARAGES, lots: LOTS });
  const who = [...permits.map((p) => PERMIT_LABEL[p]), ...(ada ? ["accessible credentials"] : [])].join(" + ");
  const lines = [`Parking for a ${when} class at ${place.name} (arriving about ${formatMinute(r.arriveMinute)}), ${who}:`];
  const refs: AnswerRef[] = [];
  if (r.replayed) lines.push("Weekends have no classes, so this shows a typical weekday (Wednesday).");
  if (!r.recommended.length) lines.push(`- I can't confirm a place near ${place.name} that your permit covers at that time.`);
  r.recommended.forEach((o, i) => {
    lines.push(optionLine(o, i + 1));
    refs.push(ref(o));
  });
  if (r.checkSign.length) {
    lines.push("Nearby, but I can't confirm your permit there:");
    for (const o of r.checkSign) {
      lines.push(optionLine(o));
      refs.push(ref(o));
    }
  }
  const src = forecastSource();
  lines.push(`Forecast from a Databricks-trained model (${src.model}) on SIMULATED demand shaped by VT's class timetable - not measured occupancy.`, SIGNAGE_NOTE);
  return { lines, refs };
}

/** Wraps an answerer: plan-ahead questions are handled here, everything else goes to `fallback` unchanged. */
export const withPlanAhead = (fallback: Answerer, getContext: () => AnswerContext, now: () => Now = nowOf): Answerer => {
  /** A plan question that asked for a permit; a short reply that is just a permit ("commuter") completes it. */
  let waiting: string | null = null;
  return async (question) => {
    const words = question.trim().split(/\s+/).length;
    const normalized = question.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (waiting && words <= 4 && detectPermits(normalized).length) {
      const completed = planAnswer(`${waiting} ${question}`, getContext(), now());
      waiting = null;
      if (completed) return completed;
    }
    const a = planAnswer(question, getContext(), now());
    if (a) {
      waiting = /I need your permit/.test(a.lines[0] ?? "") ? question : null;
      return a;
    }
    waiting = null;
    return fallback(question);
  };
};
