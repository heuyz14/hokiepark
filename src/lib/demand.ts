/**
 * Class-schedule-shaped occupancy curves for the garage simulator.
 *
 * WHAT THIS IS: a transparent, hand-parameterised model. For each garage it computes a 15-minute "class activity index"
 * (seats in session in nearby buildings, weighted by walking-distance pull), blends it with a typical staff-workday
 * shape according to who the level is signed for, and fills levels bottom-up.
 * WHAT THIS IS NOT: measured occupancy, enrollment, or a validated forecast. Seat capacity is not headcount, the
 * blend weights below are assumptions, and nothing here has ground truth to check against. Say so wherever it is shown.
 */
import type { Meeting, MeetingGroup, Weekday } from "./timetable.ts";

export const BUCKETS = 96; // 15-minute buckets per day, bucket b covers [15b, 15b + 15) minutes after midnight
export const DOWS = [1, 2, 3, 4, 5] as const; // ISO weekday numbers: Mon..Fri
const DAY_OF: Record<Weekday, number> = { M: 1, T: 2, W: 3, R: 4, F: 5 };

/** Every tunable assumption lives here so it can be shown to judges and changed in one place. */
export const MODEL = {
  /** Buildings farther than this from a garage do not feed it. */
  radiusM: 900,
  /** Cars show up this long before class starts and leave this long after it ends. */
  leadMin: 15,
  lagMin: 15,
  /** Occupancy fraction of a level at zero / peak activity. */
  floorFrac: 0.04,
  peakFrac: 0.95,
  /** Share of each level type's curve that follows class activity (the rest follows the staff workday). */
  classWeight: { cg: 0.9, fs: 0.25, fsv: 0.35, other: 0.5 } as Record<string, number>,
  /** Friday staff presence relative to Mon-Thu (hybrid schedules). */
  fridayStaffScale: 0.85,
} as const;

/** Level signage -> which curve family it follows. Mirrors LotClass values used in src/data/garages.ts. */
export function levelKind(classes: readonly string[]): keyof typeof MODEL.classWeight {
  if (classes.every((c) => c === "perry-cg")) return "cg";
  if (classes.every((c) => c === "perry-fs")) return "fs";
  if (classes.every((c) => c === "fsv")) return "fsv";
  return "other";
}

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 0..1 pull of a building on a garage: 1 next door, 0 at/after radiusM, squared falloff. */
export function pull(distanceM: number): number {
  if (distanceM >= MODEL.radiusM) return 0;
  return (1 - distanceM / MODEL.radiusM) ** 2;
}

/** A typical staff workday: ramps up 6:30-9:00, plateau, drains 15:30-18:30. Returns 0..1 for a minute of the day. */
export function staffShape(minute: number): number {
  const h = minute / 60;
  const smooth = (x: number) => x * x * (3 - 2 * x); // smoothstep on 0..1
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const up = smooth(clamp01((h - 6.5) / 2.5));
  const down = smooth(clamp01((h - 15.5) / 3));
  return up * (1 - 0.85 * down);
}

/** Nearest-rank percentile (q in 0..1) of a non-empty list; 0 for an empty one. */
export function percentile(values: readonly number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

export interface GarageIn {
  id: string;
  lat: number;
  lon: number;
  levels: { classes: readonly string[]; capacity: number }[];
}

export interface Placed {
  group: MeetingGroup;
  lat: number;
  lon: number;
}

/**
 * Raw activity (seat-weighted) per dow x bucket for one garage. Not yet normalised.
 * A meeting is "active" from startMin - leadMin to endMin + lagMin.
 */
export function rawActivity(placed: readonly Placed[], garage: { lat: number; lon: number }): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  for (const d of DOWS) out[d] = new Array<number>(BUCKETS).fill(0);
  for (const p of placed) {
    const w = pull(haversineM(p, garage));
    if (w === 0) continue;
    const seats = p.group.capacity * w;
    const from = Math.max(0, Math.floor((p.group.startMin - MODEL.leadMin) / 15));
    const to = Math.min(BUCKETS - 1, Math.floor((p.group.endMin + MODEL.lagMin - 1) / 15));
    for (const day of p.group.days) {
      const arr = out[DAY_OF[day]]!;
      for (let b = from; b <= to; b++) arr[b]! += seats;
    }
  }
  return out;
}

export interface LevelCurve {
  garageId: string;
  levelIndex: number;
  dow: number;
  /** Target occupied percent (0..100) of the level's capacity, one per 15-minute bucket. */
  pct: number[];
}

/**
 * Per-level percent-full targets for a typical Mon..Fri. Levels of the same kind form a group that fills bottom-up
 * (lowest level first), like a real garage. Deterministic: no randomness, so the generated SQL is reproducible.
 */
export function buildLevelCurves(placed: readonly Placed[], garages: readonly GarageIn[]): LevelCurve[] {
  const curves: LevelCurve[] = [];
  for (const g of garages) {
    const raw = rawActivity(placed, g);
    // One scale across the week so days stay comparable: the 95th percentile of non-empty buckets, so a normal busy
    // period reads as "full" instead of being dwarfed by the single busiest quarter-hour (activity is clamped to 1 below).
    const peak = Math.max(1, percentile(DOWS.flatMap((d) => raw[d]!).filter((v) => v > 0), 0.95));
    // group levels by kind, keeping level order (index 0 = lowest)
    const groups = new Map<string, number[]>();
    g.levels.forEach((lv, i) => {
      const k = levelKind(lv.classes);
      groups.set(k, [...(groups.get(k) ?? []), i]);
    });
    for (const d of DOWS) {
      const staffScale = d === 5 ? MODEL.fridayStaffScale : 1;
      const perLevel = new Map<number, number[]>();
      for (const [kind, idxs] of groups) {
        const cw = MODEL.classWeight[kind]!;
        const totalCap = idxs.reduce((s, i) => s + g.levels[i]!.capacity, 0);
        const occ = idxs.map(() => new Array<number>(BUCKETS).fill(0));
        for (let b = 0; b < BUCKETS; b++) {
          const activity = Math.min(1, raw[d]![b]! / peak);
          const staff = staffShape(b * 15 + 7) * staffScale;
          const frac = MODEL.floorFrac + (MODEL.peakFrac - MODEL.floorFrac) * (cw * activity + (1 - cw) * staff);
          let remaining = Math.min(1, frac) * totalCap;
          idxs.forEach((lvl, k) => {
            const take = Math.min(g.levels[lvl]!.capacity, remaining);
            occ[k]![b] = take;
            remaining -= take;
          });
        }
        idxs.forEach((lvl, k) => perLevel.set(lvl, occ[k]!.map((o) => Math.round((100 * o) / g.levels[lvl]!.capacity))));
      }
      for (const [levelIndex, pct] of [...perLevel].sort((a, b) => a[0] - b[0])) curves.push({ garageId: g.id, levelIndex, dow: d, pct });
    }
  }
  return curves;
}

/** How much of the timetable's seat capacity we could place on a building (the rest is dropped, and reported). */
export function coverage(groups: readonly MeetingGroup[], known: (code: string) => boolean): { placedSeats: number; totalSeats: number } {
  let placedSeats = 0;
  let totalSeats = 0;
  for (const g of groups) {
    const seats = g.capacity * g.days.length;
    totalSeats += seats;
    if (known(g.building)) placedSeats += seats;
  }
  return { placedSeats, totalSeats };
}

export type { Meeting };
