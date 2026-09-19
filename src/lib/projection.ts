import type { Footprint } from "../types.ts";

/** Mean Earth radius in meters (IUGG). */
const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

export interface Point {
  x: number;
  y: number;
}
export type Projector = (lat: number, lon: number) => Point;

/**
 * Equirectangular ("Plate Carree") projection centered on `origin`. Output is in meters,
 * x east, y SOUTH (SVG convention: y grows downward). Longitude is scaled by cos(origin lat)
 * so that east-west and north-south distances share one scale.
 */
export function makeProjector(origin: { lat: number; lon: number }): Projector {
  const k = Math.cos((origin.lat * Math.PI) / 180);
  return (lat, lon) => ({
    x: (lon - origin.lon) * M_PER_DEG * k,
    y: -(lat - origin.lat) * M_PER_DEG,
  });
}

/** Great-circle distance in meters. Used to calibrate the projection (Phase 1, step 1). */
export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** SVG path data ("M x y L ... Z" per ring) for a footprint, coordinates to 0.1 m. */
export function footprintToPath(fp: Footprint, project: Projector): string {
  return fp
    .map((ring) =>
      ring
        .map(([lon, lat], i) => {
          const p = project(lat, lon);
          return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        })
        .join("") + "Z",
    )
    .join("");
}
