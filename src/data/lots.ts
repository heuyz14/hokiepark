import type { Lot, LotGeo, PermitType } from "../types.ts";
import geo from "./lots.geo.json" with { type: "json" };

/**
 * Lot names, positions and status come from VT's ParkingLots GIS layer. VT's public layer has
 * NO permit-type or ADA fields, so `permit`, `hasADA` and `adaSpaces` below are HAND-SET DEMO
 * DATA (spec Section 14: ADA counts are illustrative). The five ADA lots follow spec Section 7
 * (Squires, Cassell/Coliseum, Bookstore, Drillfield North) plus Stanger St. ADA as the fifth,
 * which the spec leaves unnamed - CONFIRM WITH A TEAMMATE.
 */
interface LotMeta {
  permit: PermitType;
  ada?: number;
}

const META: Record<string, LotMeta> = {
  "lot-squires": { permit: "Mixed", ada: 8 },
  "lot-coliseum-west": { permit: "Commuter", ada: 12 },
  "lot-bookstore": { permit: "Visitor", ada: 6 },
  "lot-drillfield-north": { permit: "Faculty/Staff", ada: 5 },
  "lot-stanger-st-ada": { permit: "Mixed", ada: 9 },
  "lot-drillfield-south": { permit: "Faculty/Staff" },
  "lot-graduate-life-center-west": { permit: "Commuter" },
  "lot-owens": { permit: "Resident" },
  "lot-torgersen": { permit: "Faculty/Staff" },
  "lot-stadium": { permit: "Commuter" },
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
  if (!m) throw new Error(`No demo metadata for lot ${l.id}`);
  return { ...l, permit: m.permit, hasADA: m.ada !== undefined, adaSpaces: m.ada ?? 0 };
});
