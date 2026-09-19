import type { Garage, GarageGeo, GarageLevel } from "../types.ts";
import geo from "./garages.geo.json" with { type: "json" };

/**
 * HAND-SET DEMO DATA (spec Section 9: no live sensor feed). Positions come from VT GIS; the
 * level rows are illustrative and include edge cases on purpose: a full level (Perry L1),
 * levels with zero open ADA spaces (Perry L3, L5; North End L1, L3, L4). `capacity` includes
 * ADA spaces. Level labels follow the spec's examples.
 */
const L = (label: string, capacity: number, occupied: number, adaCapacity: number, adaOccupied: number): GarageLevel => ({
  label, capacity, occupied, adaCapacity, adaOccupied,
});

const LEVELS: Record<string, GarageLevel[]> = {
  "perry-street": [
    L("Level 1 - Commuter & graduate", 120, 120, 6, 6),
    L("Level 2 - Faculty, staff & visitor", 140, 112, 6, 3),
    L("Level 3 - Faculty, staff & visitor", 140, 131, 4, 4),
    L("Level 4 - Faculty & staff", 140, 96, 4, 1),
    L("Level 5 - Faculty & staff (roof)", 110, 58, 2, 2),
  ],
  "north-end-center": [
    L("Level 1 - Commuter & graduate", 90, 82, 5, 5),
    L("Level 2 - Commuter", 110, 79, 4, 2),
    L("Level 3 - Faculty, staff & visitor", 110, 44, 3, 3),
    L("Level 4 - Faculty, staff & visitor (roof)", 95, 21, 2, 2),
  ],
};

export const GARAGES: Garage[] = (geo as GarageGeo[]).map((g) => {
  const levels = LEVELS[g.id];
  if (!levels) throw new Error(`No demo levels for garage ${g.id}`);
  return { ...g, levels };
});
