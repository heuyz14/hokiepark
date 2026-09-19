import type { LotClass } from "../lib/permits.ts";
import type { Garage, GarageGeo, GarageLevel, PracticalInfo } from "../types.ts";
import geo from "./garages.geo.json" with { type: "json" };

/**
 * Positions come from VT GIS. Per-level splits and current occupancy are HAND-SET DEMO DATA.
 * Each garage's total capacity is VT's officially published figure from
 * data/vt_parking_app_dataset.csv; the per-level split is scaled to that total.
 * Level `classes` follow VT's official 2026-27 parking map and Quick Guide.
 */
const L = (label: string, classes: LotClass[], capacity: number, occupied: number, adaCapacity: number, adaOccupied: number): GarageLevel => ({
  label, classes, capacity, occupied, adaCapacity, adaOccupied,
});

/** The bundled sample counts. Also the offline fallback and the source for supabase/seed.sql. */
export const SEED_LEVELS: Record<string, GarageLevel[]> = {
  "perry-street": [
    L("Level 1 - Commuter & graduate", ["perry-cg"], 250, 250, 12, 12),
    L("Level 2 - Faculty & staff", ["perry-fs"], 300, 230, 12, 6),
    L("Level 3 - Faculty & staff", ["perry-fs"], 300, 270, 8, 8),
    L("Level 4 - Faculty & staff", ["perry-fs"], 300, 190, 8, 2),
    L("Level 5 - Faculty & staff (roof)", ["perry-fs"], 200, 100, 4, 4),
  ],
  "north-end-center": [
    L("Level 1 - Faculty, staff & visitor", ["fsv"], 180, 165, 10, 10),
    L("Level 2 - Faculty, staff & visitor", ["fsv"], 220, 150, 8, 3),
    L("Level 3 - Faculty, staff & visitor", ["fsv"], 220, 90, 6, 6),
    L("Level 4 - Faculty, staff & visitor (roof)", ["fsv"], 180, 40, 4, 4),
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

/** Shown on the garage sheet: the Guide calls these out by name. */
export const GARAGE_NOTE: Record<string, string> = {
  "perry-street": "A Commuter/Graduate permit only works here if you bought the Perry Street permit; it covers the C/G sections.",
  "north-end-center": "North End Garage access uses Hokie Passport scanning, and a permit is required here at all hours.",
};

export const GARAGES: Garage[] = (geo as GarageGeo[]).map((g) => {
  const levels = SEED_LEVELS[g.id];
  const info = INFO[g.id];
  if (!levels) throw new Error(`No demo levels for garage ${g.id}`);
  if (!info) throw new Error(`No practical info for garage ${g.id}`);
  return { ...g, levels: levels.map((l) => ({ ...l })), info };
});
