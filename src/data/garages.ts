import type { Garage, GarageGeo, GarageLevel, PracticalInfo } from "../types.ts";
import geo from "./garages.geo.json" with { type: "json" };

/**
 * Positions come from VT GIS. Per-level splits and current occupancy are HAND-SET DEMO DATA
 * (spec Section 9: no live sensor feed) and include edge cases on purpose: a full level (Perry
 * L1), levels with zero open ADA spaces (Perry L3, L5; North End L1, L3, L4). `capacity` includes
 * ADA spaces. Level labels follow the spec's examples.
 *
 * Each garage's TOTAL capacity is not a guess: it is VT's own officially published figure from
 * data/vt_parking_app_dataset.csv (Perry Street 1350, North End Center 800) - both garages are
 * matched 1:1 by name in that dataset. The per-level split below is scaled to sum to that total.
 */
const L = (label: string, capacity: number, occupied: number, adaCapacity: number, adaOccupied: number): GarageLevel => ({
  label, capacity, occupied, adaCapacity, adaOccupied,
});

/** The bundled sample counts. Also the offline fallback and the source for supabase/seed.sql. */
export const SEED_LEVELS: Record<string, GarageLevel[]> = {
  "perry-street": [
    L("Level 1 - Commuter & graduate", 250, 250, 12, 12),
    L("Level 2 - Faculty, staff & visitor", 300, 230, 12, 6),
    L("Level 3 - Faculty, staff & visitor", 300, 270, 8, 8),
    L("Level 4 - Faculty & staff", 300, 190, 8, 2),
    L("Level 5 - Faculty & staff (roof)", 200, 100, 4, 4),
  ],
  "north-end-center": [
    L("Level 1 - Commuter & graduate", 180, 165, 10, 10),
    L("Level 2 - Commuter", 220, 150, 8, 3),
    L("Level 3 - Faculty, staff & visitor", 220, 90, 6, 6),
    L("Level 4 - Faculty, staff & visitor (roof)", 180, 40, 4, 4),
  ],
};

/** Practical info sourced from data/vt_parking_app_dataset.csv (VT's own parking pages). */
const INFO: Record<string, PracticalInfo> = {
  "perry-street": {
    source: "parking.vt.edu",
    permitDetail: "Perry Street permit; authorized faculty/staff/visitors by level",
    overnightParking: "No",
    payment: "Not a standard ParkMobile lot - separate garage authorization required",
    enforcement: "Permit/payment rules apply; posted restrictions control",
    location: "Prices Fork parking area near Bishop-Favrao Hall; access from Perry St, West Campus Dr, and Prices Fork Rd",
    eventNote: "Possible special-event restrictions; obey posted notices",
  },
  "north-end-center": {
    source: "parking.vt.edu",
    permitDetail: "F/S; NEG; validated visitors; daily payment",
    overnightParking: "No",
    payment: "Daily garage charge; ParkMobile not standard for this garage",
    enforcement: "Permit/payment rules apply; posted restrictions control",
    location: "300 Turner Street NW, Blacksburg, VA 24061",
    eventNote: "Possible special-event restrictions; obey posted notices",
  },
};

export const GARAGES: Garage[] = (geo as GarageGeo[]).map((g) => {
  const levels = SEED_LEVELS[g.id];
  const info = INFO[g.id];
  if (!levels) throw new Error(`No demo levels for garage ${g.id}`);
  if (!info) throw new Error(`No practical info for garage ${g.id}`);
  // copy: live updates mutate GARAGES, and SEED_LEVELS must stay pristine
  return { ...g, levels: levels.map((l) => ({ ...l })), info };
});
