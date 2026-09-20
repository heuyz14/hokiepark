import { buildingCodes } from "../data/building-abbreviations.ts";
import { BUILDINGS, GARAGES, LOTS } from "../data/index.ts";
import type { Garage, Lot } from "../types.ts";
import { findPlace } from "./assistant.ts";
import { PERMIT_IDS, type AdvisorContext, type ToolName } from "./advisor-spec.ts";
import { footprintDistance, haversineMeters, walkMinutes, type Located } from "./nearby.ts";
import { garageTotals, openAdaSpaces, openSpaces } from "./occupancy.ts";
import { nearest } from "./nearby.ts";
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
const ALL: (PlaceRef & { codes: string[] })[] = [
  ...BUILDINGS.map((b) => ({ kind: "building" as const, id: b.id, name: b.name, lat: b.lat, lon: b.lon, codes: buildingCodes(b.num).map((code) => norm(code)) })),
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
    if (p.codes.includes(q)) [score, matched] = [100, "building code"];
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

const DRILLFIELD_CENTRE: Located = { lat: 37.2285, lon: -80.4225 };

/** Open spaces on the levels of `g` that the permits cover ("usable" in the rule-based assistant). */
function usableOpen(g: Garage, permits: PermitId[], ada: boolean): number {
  return g.levels.filter((l) => lotAccess({ classes: l.classes }, permits, { ada }).verdict === "yes").reduce((n, l) => n + openSpaces(l), 0);
}

function garagesTool(a: Args, ctx: AdvisorContext): ToolResult {
  const w = who(a, ctx);
  if ("err" in w) return w.err;
  const known = w.permits.length > 0 || w.ada;
  const rows = GARAGES.map((g) => {
    const t = garageTotals(g);
    return {
      id: g.id,
      name: g.name,
      current_open_spaces: t.open,
      capacity: t.capacity,
      accessible_open_spaces: t.adaOpen,
      ...(known ? { open_spaces_on_levels_your_permit_covers: usableOpen(g, w.permits, w.ada), permit_verdict: garageAccess(g.levels, w.permits, { ada: w.ada }).verdict } : {}),
    };
  });
  const key = (r: (typeof rows)[number]) => (known ? (r as { open_spaces_on_levels_your_permit_covers: number }).open_spaces_on_levels_your_permit_covers : r.current_open_spaces);
  const ranked = [...rows].sort((x, y) => key(y) - key(x));
  const top = ranked[0]!;
  return {
    ok: true,
    permit_checked: known,
    ranked_most_open_first: ranked,
    most_open: key(top) > 0 ? { id: top.id, name: top.name, open_spaces: key(top), counted: known ? "levels your permit covers" : "all levels" } : null,
    counts_are_demo_data: true,
  };
}

function accessibleTool(a: Args): ToolResult {
  const from = a.place_id === undefined || a.place_id === "" ? null : byId.get(String(a.place_id));
  if (a.place_id !== undefined && a.place_id !== "" && !from) return fail("unknown_place", "Use an id from find_place, or omit place_id for campus-wide.");
  const origin: Located = from ?? DRILLFIELD_CENTRE;
  const lots = nearest(LOTS.filter((l) => l.hasADA), origin, 2).map(({ item, meters }) => ({
    id: item.id,
    kind: "lot",
    name: `${item.name} lot`,
    ...(from ? { meters: Math.round(meters), walk_minutes: walkMinutes(meters) } : {}),
    designated_accessible_spaces: item.adaSpaces,
    signed_for: classSummary(item.classes) || "unknown",
  }));
  const garages = nearest(GARAGES.filter((g) => garageTotals(g).adaOpen > 0), origin, 1).map(({ item, meters }) => ({
    id: item.id,
    kind: "garage",
    name: item.name,
    ...(from ? { meters: Math.round(meters), walk_minutes: walkMinutes(meters) } : {}),
    accessible_spaces_open_now: garageTotals(item).adaOpen,
    levels_with_accessible_open: item.levels.filter((l) => openAdaSpaces(l) > 0).map((l) => ({ name: l.label, accessible_open: openAdaSpaces(l) })),
  }));
  return {
    ok: true,
    near: from ? from.name : "campus-wide (Drillfield centre)",
    lots,
    garages,
    reminder: "Accessible spaces need a valid state accessible plate or placard.",
    counts_are_demo_data: true,
  };
}

/** There is no vetted campus pedestrian network in this data bundle yet. This deliberately
 * returns a labelled estimate instead of drawing a route through buildings or inventing turns. */
function walkRouteTool(a: Args): ToolResult {
  const origin = byId.get(String(a.origin_id));
  const destination = byId.get(String(a.destination_id));
  if (!origin || !destination) return fail("unknown_place", "Use place ids returned by find_place.");
  const distance = Math.round(haversineMeters(origin, destination));
  return {
    ok: true,
    origin: { id: origin.id, name: origin.name },
    destination: { id: destination.id, name: destination.name },
    distance_meters: distance,
    duration_seconds: Math.round(distance / 1.3),
    walking_minutes: Math.max(1, Math.ceil(distance / (1.3 * 60))),
    route_type: "straight_line_estimate",
    note: "No vetted campus walkway graph is bundled yet; this is a straight-line walking estimate, not turn-by-turn navigation.",
  };
}

/** Reuses planAhead, the same deterministic scoring source as the Plan tab. */
function compareParkingTool(a: Args, ctx: AdvisorContext): ToolResult {
  const b = BUILDINGS.find((x) => x.id === a.building_id);
  if (!b) return fail("unknown_building", "Use a building id from find_place.");
  const day = parseDay(a.day_of_week);
  const minute = parseTime(a.class_time);
  if (day === null || minute === null) return fail("invalid_time", "Use ISO weekday 1-7 and 24-hour HH:MM.");
  const w = who(a, ctx);
  if ("err" in w) return w.err;
  if (!w.permits.length && !w.ada) return fail("no_permit", "Ask which permit the driver holds.");
  const result = planAhead({ building: b, dow: day, minute, ...w }, { garages: GARAGES, lots: LOTS });
  return {
    ok: true,
    building: b.name,
    options: result.recommended.map((o, index) => ({
      ...optionJson(o),
      rank: index + 1,
      reasons: [`${o.walkMin}-minute walk`, `${o.predictedOpen} forecast open spaces`, "permit-confirmed"],
    })),
    excluded_by_permit: result.notValid,
    forecast_is_simulated: true,
  };
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
      case "garages_now": return garagesTool(a, ctx);
      case "accessible_parking": return accessibleTool(a);
      case "calculate_walk_route": return walkRouteTool(a);
      case "compare_parking_options": return compareParkingTool(a, ctx);
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
