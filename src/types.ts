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
  /** Real polygon area from VT GIS (Shape__Area, sq ft). Used to derive a realistic capacity. */
  areaSqFt: number;
}

export type PermitType = "Faculty/Staff" | "Commuter" | "Resident" | "Visitor" | "Mixed";

/**
 * Real facts sourced from VT's own parking pages (data/vt_parking_app_dataset.csv), not simulated.
 * Only present where that dataset actually names a matching garage or lot (spec/README caveat:
 * VT publishes this on parking.vt.edu/permits.html, a different list than the GIS ParkingLots layer).
 */
export interface PracticalInfo {
  source: string;
  permitDetail: string;
  overnightParking: string;
  payment: string;
  enforcement: string;
  location: string;
  eventNote?: string;
}

export interface Lot extends LotGeo {
  permit: PermitType;
  hasADA: boolean;
  /** Illustrative count of designated accessible spaces (only when hasADA). */
  adaSpaces: number;
  /** HAND-SET DEMO DATA, like garage levels: total spaces and how many are occupied. */
  capacity: number;
  occupied: number;
  /** Only set for lots the VT dataset names (see PracticalInfo). */
  info?: PracticalInfo;
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
  capacity: number;
  occupied: number;
  adaCapacity: number;
  adaOccupied: number;
}

export interface Garage extends GarageGeo {
  levels: GarageLevel[];
  /** Both garages are named in the VT dataset, so this is always sourced, unlike Lot.info. */
  info: PracticalInfo;
}

export type SelectionKind = "garage" | "lot" | "building";
export type Selection = { kind: SelectionKind; id: string } | null;
