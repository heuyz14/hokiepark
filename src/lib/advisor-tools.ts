import codes from "../../data/timetable-building-codes.json" with { type: "json" };
import { BUILDINGS, GARAGES, LOTS } from "../data/index.ts";
import type { Garage, Lot } from "../types.ts";
import { findPlace } from "./assistant.ts";
import { PERMIT_IDS, type AdvisorContext, type ToolName } from "./advisor-spec.ts";
import { footprintDistance, walkMinutes, type Located } from "./nearby.ts";
import { garageTotals, openAdaSpaces, openSpaces } from "./occupancy.ts";
import { ARRIVE_BEFORE_MIN, FORECAST, forecastSource, planAhead, type PlanOption } from "./planahead.ts";
import { classSummary, garageAccess, lotAccess, PERMIT_LABEL, type PermitId } from "./permits.ts";
import { formatMinute, DAY_NAME } from "./planask.ts";

/**
 * The advisor's tools. Deterministic, run in the browser on the same data as the map, and the ONLY source of facts the model may use.
 * Every function validates its arguments and returns { ok, ... } as plain JSON (no functions, no dates). Errors are returned, never thrown,
 * so the model can recover (for example by asking the driver for their permit).
 */

export type ToolResult = ({ ok: true } & Record<string, unknown>) | { ok: false; error: string; hint?: string };
const fail = (error: string, hint?: string): ToolResult => ({ ok: false, error, ...(hint ? { hint } : {}) });

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

interface PlaceRef extends Located {
  kind: "building" | "garage" | "lot";
  id: string;
  name: string;
}
const codeByNum = new Map<string, string[]>();
for (const [code, v] of Object.entries(codes as Record<string, { num: string }>)) codeByNum.set(v.num, [...(codeByNum.get(v.num) ?? []), code.toLowerCase()]);

const ALL: (PlaceRef & { codes: string[] })[] = [
  ...BUILDINGS.map((b) => ({ kind: "building" as const, id: b.id, name: b.name, lat: b.lat, lon: b.lon, codes: codeByNum.get(b.num) ?? [] })),
  ...GARAGES.map((g) => ({ kind: "garage" as const, id: g.id, name: g.name, lat: g.lat, lon: g.lon, codes: [] })),
  ...LOTS.map((l) => ({ kind: "lot" as const, id: l.id, name: `${l.name} lot`, lat: l.lat, lon: l.lon, codes: [] })),
];
const byId = new Map(ALL.map((p) => [p.id, p]));
const KIND_ORDER = { building: 0, garage: 1, lot: 2 } as const;

export function searchPlaces(query: string, limit = 5): { id: string; kind: string; name: string; matched: string }[] {
  const q = norm(query);
  if (!q) return [];
  const tokens = q.split(" ").filter((t) => t.length >= 2);
  const scored: { p: (typeof ALL)[number]; score: number; matched: string }[] = [];
  const best = findPlace(query);
  for (const p of ALL) {
    const n = norm(p.name);
    let score = 0;
    let matched = "";
    if (tokens.some((t) => p.codes.includes(t))) [score, matched] = [100, "timetable code"];
    else if (n === q) [score, matched] = [95, "exact name"];
    else if (n.includes(q)) [score, matched] = [70, "name contains it"];
    else if (tokens.length && tokens.every((t) => n.includes(t))) [score, matched] = [55, "every word matches"];
    else {
      const hit = tokens.filter((t) => t.length >= 4 && n.includes(t)).length;
      if (hit) [score, matched] = [10 * hit, "partial name match"];
    }
    if (best && best.id === p.id) score = Math.max(score, 60);
    if (score) scored.push({ p, score, matched });
  }
  return scored
    .sort((a, b) => b.score - a.score || KIND_ORDER[a.p.kind] - KIND_ORDER[b.p.kind] || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map(({ p, matched }) => ({ id: p.id, kind: p.kind, name: p.name, matched }));
}

// ---- argument helpers ----
type Args = Record<string, unknown>;
const asObj = (a: unknown): Args => (a && typeof a === "object" && !Array.isArray(a) ? (a as Args) : {});

function parseTime(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}
const parseDay = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 7 ? v : null);

function who(a: Args, ctx: AdvisorContext): { permits: PermitId[]; ada: boolean } | { err: ToolResult } {
  let permits = ctx.permits;
  if (a.permits !== undefined) {
    if (!Array.isArray(a.permits) || !a.permits.every((p) => typeof p === "string" && (PERMIT_IDS as string[]).includes(p))) return { err: fail("invalid_permits", `Use only: ${PERMIT_IDS.join(", ")}`) };
    permits = a.permits as PermitId[];
  }
  const ada = typeof a.accessible === "boolean" ? a.accessible : ctx.ada;
  return { permits, ada };
}

// ---- serialisation ----
const optionJson = (o: PlanOption) => ({
  id: o.id,
  kind: o.kind,
  name: o.name,
  walk_minutes: o.walkMin,
  meters: Math.round(o.meters),
  label: o.label,
  forecast_open_spaces: o.predictedOpen,
  capacity: o.capacity,
  forecast_percent_full: o.predictedPct,
  current_open_spaces: o.nowOpen,
  ...(o.bestLevel ? { best_level: { name: o.bestLevel.label, forecast_open_spaces: o.bestLevel.predictedOpen, capacity: o.bestLevel.capacity } } : {}),
  ...(o.adaOpenEstimate !== undefined ? { forecast_accessible_open: o.adaOpenEstimate } : {}),
});
const checkJson = (o: PlanOption) => ({ id: o.id, kind: o.kind, name: o.name, walk_minutes: o.walkMin, meters: Math.round(o.meters), status: "unconfirmed: check the posted sign", ...(o.note ? { note: o.note } : {}) });

// ---- tools ----
function findPlaceTool(a: Args): ToolResult {
  if (typeof a.query !== "string" || !a.query.trim()) return fail("missing_query");
  const results = searchPlaces(a.query.slice(0, 80));
  return results.length ? { ok: true, candidates: results } : { ok: true, candidates: [], hint: "No match. Ask the driver for the building's full name." };
}

function planTool(a: Args, ctx: AdvisorContext): ToolResult {
  const b = BUILDINGS.find((x) => x.id === a.building_id);
  if (!b) return fail("unknown_building", "Use an id of kind 'building' from find_place.");
  const day = parseDay(a.day_of_week);
  const minute = parseTime(a.class_time);
  if (day === null) return fail("invalid_day_of_week", "Integer 1-7.");
  if (minute === null) return fail("invalid_class_time", "Use 24-hour HH:MM.");
  const w = who(a, ctx);
  if ("err" in w) return w.err;
  if (!w.permits.length && !w.ada) return fail("no_permit", "The driver has not chosen a permit. Ask which permit they hold.");
  const r = planAhead({ building: b, dow: day, minute, ...w }, { garages: GARAGES, lots: LOTS });
  const src = forecastSource();
  return {
    ok: true,
    building: b.name,
    day: DAY_NAME[r.dow] ?? "",
    class_time: formatMinute(minute),
    arrive_time: formatMinute(r.arriveMinute),
    arrive_minutes_before_class: ARRIVE_BEFORE_MIN,
    weekend_replayed_as_wednesday: r.replayed,
    permits: w.permits.map((p) => PERMIT_LABEL[p]),
    recommended: r.recommended.map(optionJson),
    check_sign: r.checkSign.map(checkJson),
    places_ruled_out_by_permit: r.notValid,
    forecast_is_simulated: true,
    forecast_model: src.model,
  };
}

function arrivalTool(a: Args, ctx: AdvisorContext): ToolResult {
  const b = BUILDINGS.find((x) => x.id === a.building_id);
  if (!b) return fail("unknown_building", "Use an id of kind 'building' from find_place.");
  const day = parseDay(a.day_of_week);
  const minute = parseTime(a.class_time);
  if (day === null) return fail("invalid_day_of_week");
  if (minute === null) return fail("invalid_class_time");
  const w = who(a, ctx);
  if ("err" in w) return w.err;
  if (!w.permits.length && !w.ada) return fail("no_permit", "Ask which permit the driver holds.");
  const data = { garages: GARAGES, lots: LOTS };
  const top = planAhead({ building: b, dow: day, minute, ...w }, data).recommended.slice(0, 2);
  if (!top.length) return { ok: true, building: b.name, class_time: formatMinute(minute), options: [], hint: "No permit-confirmed place nearby; see plan_parking for unconfirmed ones." };
  const offsets = [90, 75, 60, 45, 30, 15, 5];
  const options = top.map((base) => {
    const arrivals = offsets.map((off) => {
      const at = Math.max(0, minute - off);
      const r = planAhead({ building: b, dow: day, minute: at + ARRIVE_BEFORE_MIN, ...w, limit: 200 }, data);
      const hit = r.recommended.find((o) => o.id === base.id);
      return hit ? { arrive_time: formatMinute(at), minutes_before_class: off, label: hit.label, forecast_open_spaces: hit.predictedOpen, forecast_percent_full: hit.predictedPct, _at: at, _risky: hit.label === "Risky" } : null;
    });
    const rows = arrivals.filter((x): x is NonNullable<typeof x> => x !== null);
    const ok = rows.filter((r) => !r._risky).sort((x, y) => y._at - x._at)[0];
    return {
      id: base.id,
      name: base.name,
      walk_minutes: base.walkMin,
      arrivals: rows.map(({ _at, _risky, ...rest }) => rest),
      latest_arrival_not_risky: ok ? { arrive_time: ok.arrive_time, minutes_before_class: ok.minutes_before_class, label: ok.label } : null,
    };
  });
  return { ok: true, building: b.name, day: DAY_NAME[day] ?? "", class_time: formatMinute(minute), options, forecast_is_simulated: true, forecast_model: forecastSource().model };
}

const liveOpen = (g: Garage, covered: number[], ada: boolean) => covered.reduce((n, i) => n + (ada ? openAdaSpaces(g.levels[i]!) : openSpaces(g.levels[i]!)), 0);

function nowTool(a: Args, ctx: AdvisorContext): ToolResult {
  const from = byId.get(String(a.place_id));
  if (!from) return fail("unknown_place", "Use an id from find_place.");
  const w = who(a, ctx);
  if ("err" in w) return w.err;
  const known = w.permits.length > 0 || w.ada;
  const held = { ada: w.ada };
  const rows: { p: PlaceRef; meters: number; open: number; capacity: number; verdict: string; note?: string }[] = [];
  const dist = (fp: Garage["footprint"] | Lot["footprint"]) => (fp?.length ? footprintDistance(from, fp) : Infinity);
  for (const g of GARAGES) {
    const levels = g.levels.map((l, i) => ({ i, v: lotAccess({ classes: l.classes }, w.permits, held) }));
    const covered = levels.filter((x) => x.v.verdict === "yes").map((x) => x.i);
    const verdict = !known ? "unknown" : garageAccess(g.levels, w.permits, held).verdict;
    if (verdict === "no") continue;
    const use = known ? (covered.length ? covered : levels.map((x) => x.i)) : levels.map((x) => x.i);
    rows.push({ p: byId.get(g.id)!, meters: dist(g.footprint), open: liveOpen(g, use, w.ada), capacity: use.reduce((n, i) => n + g.levels[i]!.capacity, 0), verdict });
  }
  for (const l of LOTS) {
    const v = known ? lotAccess(l, w.permits, held) : { verdict: "unknown" as const };
    if (v.verdict === "no") continue;
    rows.push({ p: byId.get(l.id)!, meters: dist(l.footprint), open: openSpaces(l), capacity: l.capacity, verdict: v.verdict, ...("note" in v && v.note ? { note: v.note } : {}) });
  }
  const near = rows.filter((r) => r.meters <= 2000).sort((x, y) => x.meters - y.meters);
  const confirmed = near.filter((r) => (r.verdict === "yes" || r.verdict === "unknown") && r.open > 0).slice(0, 3);
  const unconfirmed = near.filter((r) => r.verdict === "check").slice(0, 2);
  const fmt = (r: (typeof rows)[number]) => ({ id: r.p.id, kind: r.p.kind, name: r.p.name, meters: Math.round(r.meters), walk_minutes: walkMinutes(r.meters), current_open_spaces: r.open, capacity: r.capacity });
  return {
    ok: true,
    near: from.name,
    permit_checked: known,
    ...(known ? {} : { note: "The driver's permit is not set, so eligibility was NOT checked." }),
    nearest_with_open_spaces: confirmed.map(fmt),
    unconfirmed_check_the_sign: unconfirmed.map((r) => ({ ...fmt(r), ...(r.note ? { note: r.note } : {}) })),
    counts_are_demo_data: true,
  };
}

function permitTool(a: Args, ctx: AdvisorContext): ToolResult {
  const w = who(a, ctx);
  if ("err" in w) return w.err;
  if (!w.permits.length && !w.ada) return fail("no_permit", "Ask which permit the driver holds.");
  const held = { ada: w.ada };
  const lot = LOTS.find((l) => l.id === a.place_id);
  if (lot) {
    const v = lotAccess(lot, w.permits, held);
    return { ok: true, place: `${lot.name} lot`, signed_for: classSummary(lot.classes) || "unknown", verdict: v.verdict, ...(v.note ? { note: v.note } : {}) };
  }
  const g = GARAGES.find((x) => x.id === a.place_id);
  if (g) {
    const t = garageTotals(g);
    return {
      ok: true,
      place: g.name,
      verdict: garageAccess(g.levels, w.permits, held).verdict,
      levels: g.levels.map((l) => {
        const v = lotAccess({ classes: l.classes }, w.permits, held);
        return { name: l.label, signed_for: classSummary(l.classes), verdict: v.verdict, ...(v.note ? { note: v.note } : {}) };
      }),
      total_capacity: t.capacity,
    };
  }
  return fail("unknown_place", "Use the id of a lot or garage from find_place.");
}

export function runTool(name: string, args: unknown, ctx: AdvisorContext): ToolResult {
  const a = asObj(args);
  try {
    switch (name as ToolName) {
      case "find_place": return findPlaceTool(a);
      case "plan_parking": return planTool(a, ctx);
      case "parking_now": return nowTool(a, ctx);
      case "arrival_advice": return arrivalTool(a, ctx);
      case "permit_check": return permitTool(a, ctx);
      default: return fail("unknown_tool");
    }
  } catch (err) {
    return fail("tool_error", (err as Error).message.slice(0, 120));
  }
}

/** Ids the tools have surfaced, so the answer's PLACES line can be validated against real results. */
export function idsIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) idsIn(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "id" && typeof v === "string" && byId.has(v)) out.add(v);
      else idsIn(v, out);
    }
  }
  return out;
}
export const placeRef = (id: string) => byId.get(id) ?? null;
export const forecastFile = FORECAST;
