import type { Lot, LotGeo } from "../types.ts";
import type { LotClass } from "../lib/permits.ts";
import geo from "./lots.geo.json" with { type: "json" };

/**
 * Lot names, positions and status come from VT's ParkingLots GIS layer, which carries NO permit
 * or ADA fields. `classes` below is read off VT Parking Services' official 2026-27 campus parking
 * map (the colour legend: orange = Faculty/Staff/Visitor, teal = Commuter/Graduate, purple =
 * Faculty/Staff 24-hour, blue = Graduate, pink = ADA/Service 24-hour, dark maroon = Any University
 * Permit, yellow = F/S and Perry Street permit).
 *
 * `confirm: true` marks a lot whose GIS name has no exact label on the printed map, so its class is
 * inferred from its position among neighbouring lots. The UI degrades these to "check the sign"
 * rather than showing a confident "you can park here" - VERIFY THESE AGAINST parking.vt.edu.
 *
 * `ada`/`adaSpaces` remain illustrative demo counts (spec Section 14).
 */
interface LotMeta {
  classes: LotClass[];
  ada?: number;
  confirm?: true;
}

const META: Record<string, LotMeta> = {
  // Labelled directly on the official map.
  "lot-squires": { classes: ["fsv"], ada: 8 }, // "Squires F/S/V"
  "lot-coliseum-west": { classes: ["fsv", "cg"], ada: 12 }, // map shows both a "Coliseum West F/S/V" and a "Coliseum West C/G" section
  "lot-drillfield-north": { classes: ["fsv"], ada: 5 }, // "Drillfield North F/S/V"
  "lot-drillfield-south": { classes: ["fsv"] }, // "Drillfield South F/S/V"
  "lot-stanger-st-ada": { classes: ["ada-service-24"], ada: 9 }, // pink "ADA/Service 24 hour"
  "lot-graduate-life-center-west": { classes: ["graduate"] }, // blue "Squires Graduate", beside the Graduate Life Center
  "lot-owens": { classes: ["fs-24"] }, // purple "Owens"
  "lot-dietrick": { classes: ["fs-24"] }, // purple "Dietrick F/S 24-hour"
  "lot-stadium": { classes: ["any-permit"] }, // dark maroon "Stadium - Any University Permit"
  "lot-ag-quad": { classes: ["fsv"] }, // "Ag Quad F/S/V"
  "lot-engel": { classes: ["fsv"] }, // "Engel F/S"
  "lot-lower-stanger": { classes: ["fsv"] }, // "Lower Stanger F/S"
  "lot-upper-stanger": { classes: ["fsv"] }, // "Upper Stanger F/S"
  "lot-alumni-mall-north": { classes: ["fsv"] }, // orange lots along Alumni Mall
  "lot-alumni-mall-south": { classes: ["fsv"] },

  // Not labelled by these names on the printed map; inferred from position. Needs a human check.
  "lot-bookstore": { classes: ["fsv"], ada: 6, confirm: true },
  "lot-torgersen": { classes: ["fsv"], confirm: true },
  "lot-durham": { classes: ["fsv"], confirm: true },
  "lot-pamplin": { classes: ["fsv"], confirm: true },
};

export const LOTS: Lot[] = (geo as LotGeo[]).map((l) => {
  const m = META[l.id];
  if (!m) throw new Error(`No permit metadata for lot ${l.id}`);
  return { ...l, classes: m.classes, needsConfirm: m.confirm === true, hasADA: m.ada !== undefined, adaSpaces: m.ada ?? 0 };
});
