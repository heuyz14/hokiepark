import type { LotClass } from "./lib/permits.ts";

/** A polygon ring as [lon, lat] pairs (GeoJSON order). A footprint may have several rings. */
export type Ring = [number, number][];
export type Footprint = Ring[];

export type BuildingCategory = "academic" | "residential" | "support" | "athletic";

export interface Building {
  id: string;
  num: string;
  name: string;
  category: BuildingCategory;
  lat: number;
  lon: number;
  footprint: Footprint;
}

/** Shape written by scripts/build-data.ts (GIS-derived only, no hand-authored fields). */
export interface LotGeo {
  id: string;
  name: string;
  number: number | null;
  status: string;
  lat: number;
  lon: number;
  footprint: Footprint;
}

export interface Lot extends LotGeo {
  /** Categories this lot is signed as, from VT's official parking map. Several when a lot is split. */
  classes: LotClass[];
  /** True when the class was inferred from map position, not a printed label: never show a confident "yes". */
  needsConfirm: boolean;
  hasADA: boolean;
  /** Illustrative count of designated accessible spaces (only when hasADA). */
  adaSpaces: number;
}

export interface GarageGeo {
  id: string;
  name: string;
  lat: number;
  lon: number;
  footprint: Footprint;
}

export interface GarageLevel {
  label: string;
  /** What this level is signed as; drives permit eligibility per level. */
  classes: LotClass[];
  capacity: number;
  occupied: number;
  adaCapacity: number;
  adaOccupied: number;
}

export interface Garage extends GarageGeo {
  levels: GarageLevel[];
}

export type SelectionKind = "garage" | "lot" | "building";
export type Selection = { kind: SelectionKind; id: string } | null;
