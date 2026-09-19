import type { Garage, GarageGeo, GarageLevel } from "../types.ts";
import type { LotClass } from "../lib/permits.ts";
import geo from "./garages.geo.json" with { type: "json" };

/**
 * Occupancy is HAND-SET DEMO DATA (spec Section 9: no live sensor feed), and includes edge cases
 * on purpose: a full level (Perry L1), levels with zero open ADA spaces.
 *
 * Level `classes` are NOT invented - they follow VT's official 2026-27 parking map and Quick Guide:
 *  - Perry Street Garage is yellow "F/S and Perry Street Permit"; the Guide says a plain C/G permit
 *    "is not valid in Perry Street Garage unless a Perry permit is purchased", and that the C/G
 *    Perry permit is valid in "C/G sections of the Perry Street Garage" - so L1 is the C/G section.
 *  - North End Center Garage is orange "F/S/V" on the map, and the Guide lists it among the places
 *    a permit is required at all hours.
 */
const L = (label: string, classes: LotClass[], capacity: number, occupied: number, adaCapacity: number, adaOccupied: number): GarageLevel => ({
  label, classes, capacity, occupied, adaCapacity, adaOccupied,
});

/** The bundled sample counts. Also the offline fallback and the source for supabase/seed.sql. */
export const SEED_LEVELS: Record<string, GarageLevel[]> = {
  "perry-street": [
    L("Level 1 - Commuter & graduate", ["perry-cg"], 120, 120, 6, 6),
    L("Level 2 - Faculty & staff", ["perry-fs"], 140, 112, 6, 3),
    L("Level 3 - Faculty & staff", ["perry-fs"], 140, 131, 4, 4),
    L("Level 4 - Faculty & staff", ["perry-fs"], 140, 96, 4, 1),
    L("Level 5 - Faculty & staff (roof)", ["perry-fs"], 110, 58, 2, 2),
  ],
  "north-end-center": [
    L("Level 1 - Faculty, staff & visitor", ["fsv"], 90, 82, 5, 5),
    L("Level 2 - Faculty, staff & visitor", ["fsv"], 110, 79, 4, 2),
    L("Level 3 - Faculty, staff & visitor", ["fsv"], 110, 44, 3, 3),
    L("Level 4 - Faculty, staff & visitor (roof)", ["fsv"], 95, 21, 2, 2),
  ],
};

/** Shown on the garage sheet: the Guide calls these out by name. */
export const GARAGE_NOTE: Record<string, string> = {
  "perry-street": "A Commuter/Graduate permit only works here if you bought the Perry Street permit; it covers the C/G sections.",
  "north-end-center": "North End Garage access uses Hokie Passport scanning, and a permit is required here at all hours.",
};

export const GARAGES: Garage[] = (geo as GarageGeo[]).map((g) => {
  const levels = SEED_LEVELS[g.id];
  if (!levels) throw new Error(`No demo levels for garage ${g.id}`);
  // copy: live updates mutate GARAGES, and SEED_LEVELS must stay pristine
  return { ...g, levels: levels.map((l) => ({ ...l })) };
});
