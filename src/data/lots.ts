import type { Lot, LotGeo, PermitType, PracticalInfo } from "../types.ts";
import geo from "./lots.geo.json" with { type: "json" };

/**
 * Lot names, positions, status and `areaSqFt` come from VT's own ParkingLots GIS layer (every
 * "Main Campus" lot, minus a handful of driveways/loading docks - see scripts/build-data.ts).
 * VT's public layer has NO permit-type, ADA, or occupancy fields, so those are still simulated
 * (spec Section 14: illustrative, not from live sensors, same treatment as garages.ts) - but
 * `capacity` is no longer a hand-typed guess for 88 different lots. It's derived from each lot's
 * REAL polygon area (`SQFT_PER_SPACE`, a standard surface-lot planning ratio), so a big lot gets
 * a big number and a small one gets a small one, grounded in something real instead of a guess.
 * `occupied` is a deterministic (stable across builds), lot-specific fraction of that capacity -
 * still simulated, but no two unrelated lots share a coincidentally identical number.
 *
 * data/vt_parking_app_dataset.csv (VT's own parking.vt.edu/permits.html listing) is a SEPARATE
 * naming system from the GIS ParkingLots layer and does not line up lot-for-lot with it - it
 * never publishes a capacity for any surface lot (`capacity_status: not_publicly_verified` on
 * every row) and uses different names for some of the same places. Exactly three lots can be
 * matched to it with confidence, by name and location: Stadium, Bookstore, and Coliseum West
 * (VT's "Coliseum Lot", both by Cassell Coliseum). Those three get a sourced `info` block below
 * and, where the CSV's real eligibility rules disagreed with the original guess, a corrected
 * `permit`. Every other lot's `permit` is HAND-SET DEMO DATA: the 19 lots from the original
 * curated set keep their previously-assigned category; the ~69 lots added to reach full GIS
 * coverage default to "Mixed" (VT publishes no permit signal for them at all - "Mixed" says
 * "rules vary/unconfirmed" rather than fabricating a specific audience we have no evidence for).
 * The five ADA lots follow spec Section 7 (Squires, Cassell/Coliseum, Bookstore, Drillfield
 * North) plus Stanger St. ADA as the fifth, which the spec leaves unnamed - CONFIRM WITH A
 * TEAMMATE.
 */

/** ~330 sq ft per surface space (stall + its share of a drive aisle) - a standard planning rule of thumb. */
const SQFT_PER_SPACE = 330;
/** Real VT surface lots run from a handful of spaces to several hundred; this keeps a few outlier
 * polygons (e.g. Duck Pond Dr., whose GIS shape includes roadway well beyond the marked stalls)
 * from producing an implausible four-digit lot. */
const MIN_CAPACITY = 10;
const MAX_CAPACITY = 900;

function deriveCapacity(areaSqFt: number): number {
  const raw = Math.round(areaSqFt / SQFT_PER_SPACE / 5) * 5;
  return Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, raw));
}

/** Deterministic (not Math.random - stable across builds and tests) unit value from a string. */
function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

/** Occupied fraction of capacity: mostly 45-93% full, so most lots read Open with a few Limited. */
function deriveOccupiedFraction(id: string): number {
  return 0.45 + hashUnit(id) * 0.48;
}

/** Hand-set exceptions to the deterministic fraction, to guarantee the demo's edge cases: a full
 * lot (Bookstore - a small paid lot that realistically does fill up) and near-full "Limited" lots. */
const OCCUPIED_FRACTION_OVERRIDES: Record<string, number> = {
  "lot-bookstore": 1,
  "lot-squires": 0.93,
  "lot-owens": 0.93,
};

interface LotMeta {
  permit: PermitType;
  ada?: number;
  info?: PracticalInfo;
}

const VT_DOT_EDU = "parking.vt.edu";

/** The 19 lots from the original curated set, plus the 3 CSV-sourced corrections/info blocks. */
const META: Record<string, LotMeta> = {
  "lot-squires": { permit: "Mixed", ada: 8 },
  "lot-coliseum-west": {
    permit: "Commuter",
    ada: 12,
    info: {
      source: VT_DOT_EDU,
      permitDetail: "C/G sections; hourly/metered spaces; other areas as posted",
      overnightParking: "Depends on posted rules",
      payment: "Yes, hourly parking is documented in this lot",
      enforcement: "Mon-Fri 7:00-22:00 unless 24-hour posted",
      location: "Cassell Coliseum area",
      eventNote: "Frequently affected by athletics/special events",
    },
  },
  // corrected from "Visitor": VT's own listing says this is paid hourly parking open to anyone, not visitor-only
  "lot-bookstore": {
    permit: "Mixed",
    ada: 6,
    info: {
      source: VT_DOT_EDU,
      permitDetail: "Hourly/metered plus any posted restrictions",
      overnightParking: "Depends on posted rules",
      payment: "Yes, hourly parking documented",
      enforcement: "Mon-Fri 7:00-22:00 unless otherwise posted",
      location: "Kent Street, near University Bookstore",
    },
  },
  "lot-drillfield-north": { permit: "Faculty/Staff", ada: 5 },
  "lot-stanger-st-ada": { permit: "Mixed", ada: 9 },
  "lot-drillfield-south": { permit: "Faculty/Staff" },
  "lot-graduate-life-center-west": { permit: "Commuter" },
  "lot-owens": { permit: "Resident" },
  "lot-torgersen": { permit: "Faculty/Staff" },
  // corrected from "Commuter": VT's own listing says this is resident + event-day parking
  "lot-stadium": {
    permit: "Resident",
    info: {
      source: VT_DOT_EDU,
      permitDetail: "R and event-designated areas",
      overnightParking: "Depends on posted rules",
      payment: "Only where specifically signed",
      enforcement: "Mon-Fri 7:00-22:00 unless 24-hour posted",
      location: "Stadium area",
      eventNote: "Frequently affected by football/basketball/special events",
    },
  },
  "lot-alumni-mall-north": { permit: "Faculty/Staff" },
  "lot-alumni-mall-south": { permit: "Faculty/Staff" },
  "lot-dietrick": { permit: "Resident" },
  "lot-ag-quad": { permit: "Faculty/Staff" },
  "lot-engel": { permit: "Commuter" },
  "lot-durham": { permit: "Faculty/Staff" },
  "lot-lower-stanger": { permit: "Commuter" },
  "lot-upper-stanger": { permit: "Commuter" },
  "lot-pamplin": { permit: "Faculty/Staff" },
};

export const LOTS: Lot[] = (geo as LotGeo[]).map((l) => {
  const m = META[l.id];
  const capacity = deriveCapacity(l.areaSqFt);
  const fraction = OCCUPIED_FRACTION_OVERRIDES[l.id] ?? deriveOccupiedFraction(l.id);
  return {
    ...l,
    permit: m?.permit ?? "Mixed",
    hasADA: m?.ada !== undefined,
    adaSpaces: m?.ada ?? 0,
    capacity,
    occupied: Math.min(capacity, Math.round(capacity * fraction)),
    info: m?.info,
  };
});
