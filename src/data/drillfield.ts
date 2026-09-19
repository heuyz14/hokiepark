import type { Footprint, Ring } from "../types.ts";

/**
 * VT publishes no polygon for the Drillfield, so this is a VISUALLY ESTIMATED ellipse (same
 * class of estimate as the spec's ~9 non-GIS buildings) sized to the gap between Burruss, Williams Hall,
 * Pamplin, War Memorial Chapel and War Memorial Gym. tests/drillfield.test.ts asserts that no
 * building footprint vertex falls inside it.
 */
const CENTER = { lat: 37.22775, lon: -80.42215 };
const HALF_LON = 0.00170; // ~150 m east-west
const HALF_LAT = 0.00080; // ~89 m north-south
const STEPS = 48;

export const DRILLFIELD: Footprint = [
  Array.from({ length: STEPS + 1 }, (_, i): Ring[number] => {
    const a = (i / STEPS) * 2 * Math.PI;
    return [
      Math.round((CENTER.lon + HALF_LON * Math.cos(a)) * 1e6) / 1e6,
      Math.round((CENTER.lat + HALF_LAT * Math.sin(a)) * 1e6) / 1e6,
    ];
  }),
];
export const DRILLFIELD_CENTER = CENTER;
