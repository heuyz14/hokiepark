import predictions from "../data/predictions.json" with { type: "json" };
import type { Footprint, Garage, Lot } from "../types.ts";
import { footprintDistance, walkMinutes, type Located } from "./nearby.ts";
import { openAdaSpaces, openSpaces } from "./occupancy.ts";
import { lotAccess, type PermitId, type Verdict } from "./permits.ts";

/**
 * "Plan ahead": given a destination building, a weekday, a class time and a permit, rank where to park by walk distance and
 * FORECAST fullness at arrival. Forecast numbers come from src/data/predictions.json, which the Databricks batch job writes
 * (databricks/notebooks/07_batch_score_export.py). They are SIMULATION-trained (VT class timetable + assumed driver behaviour),
 * not measured occupancy, and every label here is a forecast, never a fact.
 *
 * Rules that must not bend: a place is only RECOMMENDED when the permit rules say "yes"; "check" places are listed apart and
 * capped; "no" places are never shown. A garage is scored only on the levels the driver's permit actually covers.
 */

export interface PredictionUnit {
  id: string;
  name: string;
  kind: "lot" | "garage-level";
  capacity: number;
  /** ISO weekday "1".."5" -> 96 percent-full values, one per 15-minute bucket from midnight. */
  pct: Record<string, number[]>;
}
export interface PredictionFile {
  generated_at: string;
  kind: "SIMULATED";
  disclaimer: string;
  term: string;
  model: { name: string; version: number };
  buckets: number;
  units: PredictionUnit[];
}

export const FORECAST = predictions as PredictionFile;

/** Cars arrive this long before class starts; the forecast is read at the arrival time. */
export const ARRIVE_BEFORE_MIN = 15;
const MAX_WALK_M = 2000;
const CHECK_RADIUS_M = 800;
const MAX_RECOMMENDED = 3;
const MAX_CHECK = 2;

const indexOf = (file: PredictionFile) => new Map(file.units.map((u) => [u.id, u]));
const cache = new WeakMap<PredictionFile, Map<string, PredictionUnit>>();
const unitOf = (file: PredictionFile, id: string) => {
  let m = cache.get(file);
  if (!m) cache.set(file, (m = indexOf(file)));
  return m.get(id);
};

export const bucketOf = (minute: number) => Math.min(95, Math.max(0, Math.floor(minute / 15)));

/** Weekends have no class schedule; the app replays a typical Wednesday (same rule as the live simulator). */
export const effectiveDow = (dow: number) => (dow >= 1 && dow <= 5 ? dow : 3);

export function forecastPct(id: string, dow: number, minute: number, file: PredictionFile = FORECAST): number | null {
  const u = unitOf(file, id);
  const series = u?.pct[String(effectiveDow(dow))];
  return series ? (series[bucketOf(minute)] ?? null) : null;
}

export type PlanLabel = "Likely open" | "Filling up" | "Risky";

/** Risky: under 8% (or fewer than 5 spaces) forecast open. Filling up: under 25% open. Otherwise likely open. */
export function planLabel(predictedPct: number, predictedOpen: number): PlanLabel {
  const openFrac = 1 - predictedPct / 100;
  if (openFrac < 0.08 || predictedOpen < 5) return "Risky";
  if (openFrac < 0.25) return "Filling up";
  return "Likely open";
}

export interface PlanInput {
  /** Destination building (only its position is used). */
  building: Located & { name?: string };
  /** ISO weekday 1-7 (weekends replay Wednesday). */
  dow: number;
  /** Minute of the day the class starts. */
  minute: number;
  permits: PermitId[];
  ada: boolean;
  /** How many recommendations to return (default 3). */
  limit?: number;
}

export interface PlanOption {
  kind: "garage" | "lot";
  id: string;
  name: string;
  meters: number;
  walkMin: number;
  arriveMinute: number;
  predictedPct: number;
  predictedOpen: number;
  capacity: number;
  label: PlanLabel;
  verdict: Verdict;
  note?: string;
  /** Live count right now, from the same data the map shows (for comparison with the forecast). */
  nowOpen: number;
  /** Accessible spaces forecast open on the covered levels (only when the driver has accessible credentials). */
  adaOpenEstimate?: number;
  /** Garages: the covered level forecast to have the most room. */
  bestLevel?: { label: string; predictedOpen: number; capacity: number };
  score: number;
}

export interface PlanResult {
  arriveMinute: number;
  dow: number;
  replayed: boolean;
  needsPermit: boolean;
  recommended: PlanOption[];
  /** Nearby places we cannot vouch for (permit unknown or unconfirmed): never labelled as good news. */
  checkSign: PlanOption[];
  /** Places whose signage rules the driver's permit out. Counted, never listed. */
  notValid: number;
}

/** Walk minutes plus a fullness penalty (0 up to 70% full, rising to 25 min-equivalents at 100%); Risky adds a flat 30. */
export function planScore(walkMin: number, predictedPct: number, label: PlanLabel): number {
  return walkMin + (Math.max(0, predictedPct - 70) / 30) * 25 + (label === "Risky" ? 30 : 0);
}

const openFrom = (capacity: number, pct: number) => Math.max(0, Math.round(capacity * (1 - pct / 100)));

export function planAhead(input: PlanInput, data: { garages: Garage[]; lots: Lot[] }, file: PredictionFile = FORECAST): PlanResult {
  const dow = effectiveDow(input.dow);
  const arriveMinute = Math.max(0, input.minute - ARRIVE_BEFORE_MIN);
  const empty: PlanResult = { arriveMinute, dow, replayed: input.dow < 1 || input.dow > 5, needsPermit: false, recommended: [], checkSign: [], notValid: 0 };
  if (!input.permits.length && !input.ada) return { ...empty, needsPermit: true };

  const held = { ada: input.ada };
  const yes: PlanOption[] = [];
  const check: PlanOption[] = [];
  let notValid = 0;
  const distance = (fp: Footprint | undefined, fallback: Located) => (fp?.length ? footprintDistance(input.building, fp) : footprintDistance(input.building, [[[fallback.lon, fallback.lat]]]));

  const push = (o: Omit<PlanOption, "label" | "score" | "walkMin" | "arriveMinute" | "predictedOpen">, predictedOpen: number) => {
    if (o.meters > MAX_WALK_M) return;
    const walkMin = walkMinutes(o.meters);
    const label = planLabel(o.predictedPct, predictedOpen);
    const opt: PlanOption = { ...o, walkMin, arriveMinute, predictedOpen, label, score: planScore(walkMin, o.predictedPct, label) };
    (o.verdict === "yes" ? yes : check).push(opt);
  };

  for (const g of data.garages) {
    const covered = g.levels.map((l, i) => ({ l, i, v: lotAccess({ classes: l.classes }, input.permits, held) }));
    const usable = covered.filter((c) => c.v.verdict === "yes");
    const maybe = covered.filter((c) => c.v.verdict === "check");
    const group = usable.length ? usable : maybe;
    if (!group.length) {
      notValid++;
      continue;
    }
    let capacity = 0;
    let open = 0;
    let adaOpen = 0;
    let nowOpen = 0;
    let best: PlanOption["bestLevel"];
    for (const { l, i } of group) {
      const pct = forecastPct(`${g.id}:${i}`, dow, arriveMinute, file);
      if (pct === null) continue;
      const lo = openFrom(l.capacity, pct);
      capacity += l.capacity;
      open += lo;
      adaOpen += openFrom(l.adaCapacity, pct);
      nowOpen += input.ada ? openAdaSpaces(l) : openSpaces(l);
      if (!best || lo > best.predictedOpen) best = { label: l.label, predictedOpen: lo, capacity: l.capacity };
    }
    if (!capacity) continue;
    const predictedPct = Math.round(100 * (1 - open / capacity));
    const first = group[0]!.v;
    push(
      {
        kind: "garage", id: g.id, name: g.name, meters: distance(g.footprint, g), predictedPct, capacity, verdict: usable.length ? "yes" : "check",
        ...(first.note && !usable.length ? { note: first.note } : {}), nowOpen, ...(input.ada ? { adaOpenEstimate: adaOpen } : {}), ...(best ? { bestLevel: best } : {}),
      },
      open,
    );
  }

  for (const lot of data.lots) {
    const v = lotAccess(lot, input.permits, held);
    if (v.verdict === "no") {
      notValid++;
      continue;
    }
    const pct = forecastPct(lot.id, dow, arriveMinute, file);
    if (pct === null) continue;
    push(
      { kind: "lot", id: lot.id, name: `${lot.name} lot`, meters: distance(lot.footprint, lot), predictedPct: pct, capacity: lot.capacity, verdict: v.verdict, ...(v.note ? { note: v.note } : {}), nowOpen: openSpaces(lot) },
      openFrom(lot.capacity, pct),
    );
  }

  const byScore = (a: PlanOption, b: PlanOption) => a.score - b.score || a.meters - b.meters || a.id.localeCompare(b.id);
  return {
    ...empty,
    recommended: yes.sort(byScore).slice(0, input.limit ?? MAX_RECOMMENDED),
    // unconfirmed places are ordered by distance only: their forecast is not something to steer a driver by
    checkSign: check.filter((o) => o.meters <= CHECK_RADIUS_M).sort((a, b) => a.meters - b.meters || a.id.localeCompare(b.id)).slice(0, MAX_CHECK),
    notValid,
  };
}

export const forecastSource = (file: PredictionFile = FORECAST) => ({
  model: `${file.model.name.split(".").pop()} v${file.model.version}`,
  generated: file.generated_at.slice(0, 10),
  term: file.term,
});
