import type { Footprint } from "../types.ts";

/** Mean Earth radius in meters (IUGG). */
const EARTH_RADIUS_M = 6_371_008.8;

export interface Located {
  lat: number;
  lon: number;
}

/** Great-circle distance in meters. */
export function haversineMeters(a: Located, b: Located): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
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
