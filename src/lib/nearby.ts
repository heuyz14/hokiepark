import type { Footprint } from "../types.ts";
import { haversineMeters } from "./projection.ts";

export interface Located {
  lat: number;
  lon: number;
}

/** Meters from a point to the nearest vertex of a footprint. Better than centroid distance for big lots. */
export function footprintDistance(from: Located, fp: Footprint): number {
  let best = Infinity;
  for (const ring of fp) for (const [lon, lat] of ring) best = Math.min(best, haversineMeters(from, { lat, lon }));
  return best;
}

/**
 * The `n` closest items to a point, nearest first, with straight-line distance in meters.
 * Items that carry a `footprint` are measured to their nearest edge vertex, others to their point.
 */
export function nearest<T extends Located & { footprint?: Footprint }>(items: T[], from: Located, n: number): { item: T; meters: number }[] {
  return items
    .map((item) => ({ item, meters: item.footprint?.length ? footprintDistance(from, item.footprint) : haversineMeters(from, item) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, n);
}

/** ~80 m per minute walking pace. Rounded up so "1 min" is the floor. */
export const walkMinutes = (meters: number) => Math.max(1, Math.ceil(meters / 80));

/** "120 m" under ~1 km, else "1.2 km". Rounded to 10 m so numbers do not look falsely precise. */
export const formatMeters = (m: number) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
