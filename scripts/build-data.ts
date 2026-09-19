/**
 * Phase 0: flatten the raw VT ArcGIS responses (data/raw/*.json, fetched once by
 * scripts/fetch-gis.ts) into the flat shapes the app consumes. Never hits the network.
 *
 * Selection is rule-based so it is reproducible, not the spec's hand-picked 92:
 *   buildings: four VT categories, existing, inside CORE_BOX, footprint >= MIN_AREA,
 *              plus LANDMARK_NUMS regardless of box. Multi-part buildings are merged by bldg_num.
 *   lots:      the curated CAMPUS_LOTS list below (grouped by lot name, polygons merged).
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Building, BuildingCategory, Footprint, GarageGeo, LotGeo, Ring } from "../src/types.ts";

interface EsriFeature<A> {
  attributes: A;
  geometry?: { rings: Ring[] };
}
interface BuildingAttrs {
  name: string | null;
  bldg_num: string | null;
  bldg_use: string | null;
  status: string | null;
  latitude: number | null;
  longitude: number | null;
  Shape__Area: number;
}
interface LotAttrs {
  lot_name: string | null;
  lot_number: number | null;
  status: string | null;
  precinct: string | null;
}

const CORE_BOX = { latMin: 37.2215, latMax: 37.2335, lonMin: -80.4265, lonMax: -80.416 };
const MIN_AREA = 1000; // sq ft (state-plane units of Shape__Area)
const LANDMARK_NUMS = new Set(["0185", "0187"]); // Lane Stadium, Cassell Coliseum sit south of the box
const GARAGE_NUMS: Record<string, { id: string; name: string }> = {
  "0247": { id: "perry-street", name: "Perry Street Garage" },
  "0618B": { id: "north-end-center", name: "North End Center Garage" },
};
const CATEGORY: Record<string, BuildingCategory> = {
  Academic: "academic",
  "Residential & Dining": "residential",
  "Support Facilities": "support",
  Athletic: "athletic",
};
/** Spec Section 5/7 landmark names first, then other recognizable main-campus lots (19 total). */
const CAMPUS_LOTS = [
  "Squires", "Coliseum West", "Bookstore", "Drillfield North", "Stanger St. ADA",
  "Drillfield South", "Graduate Life Center West", "Owens", "Torgersen", "Stadium",
  "Alumni Mall North", "Alumni Mall South", "Dietrick", "Ag Quad", "Engel",
  "Durham", "Lower Stanger", "Upper Stanger", "Pamplin",
];

const read = <A>(f: string) =>
  (JSON.parse(readFileSync(new URL(`../data/raw/${f}`, import.meta.url), "utf8")) as { features: EsriFeature<A>[] }).features;

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const titleCase = (s: string) =>
  s.replace(/\w\S*/g, (w) => (/^[A-Z]{2,4}$/.test(w) && w !== w.toLowerCase() && w.length <= 3 ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase()));

function footprintOf(fs: EsriFeature<unknown>[]): Footprint {
  return fs.flatMap((f) => f.geometry?.rings ?? []).map((r) => r.map(([x, y]) => [round(x), round(y)] as [number, number]));
}
function centroid(fp: Footprint): { lat: number; lon: number } {
  const pts = fp.flat();
  return {
    lon: round(pts.reduce((s, p) => s + p[0], 0) / pts.length),
    lat: round(pts.reduce((s, p) => s + p[1], 0) / pts.length),
  };
}
function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) (m.get(key(x)) ?? m.set(key(x), []).get(key(x))!).push(x);
  return m;
}

// --- buildings & garages ---
const rawBuildings = read<BuildingAttrs>("buildings.raw.json").filter((f) => f.geometry && f.attributes.bldg_num);
const garages: GarageGeo[] = [];
const buildings: Building[] = [];

for (const [num, parts] of groupBy(rawBuildings, (f) => f.attributes.bldg_num!)) {
  const a = parts[0]!.attributes;
  const garage = GARAGE_NUMS[num];
  if (garage) {
    const fp = footprintOf(parts);
    garages.push({ ...garage, ...centroid(fp), footprint: fp });
    continue;
  }
  const category = CATEGORY[a.bldg_use ?? ""];
  if (!category || !parts.every((p) => p.attributes.status === "Existing Conditions")) continue;
  const area = parts.reduce((s, p) => s + p.attributes.Shape__Area, 0);
  const lat = a.latitude ?? 0;
  const lon = a.longitude ?? 0;
  const inBox = lat >= CORE_BOX.latMin && lat <= CORE_BOX.latMax && lon >= CORE_BOX.lonMin && lon <= CORE_BOX.lonMax;
  if (!(LANDMARK_NUMS.has(num) || (inBox && area >= MIN_AREA))) continue;
  // "Lane Stadium (east stands)" -> "Lane Stadium"; parts of one building share a bldg_num.
  const name = (a.name ?? `Building ${num}`).replace(/\s*\(.*\)\s*$/, "").trim();
  const fp = footprintOf(parts);
  buildings.push({ id: `b${num}`, num, name, category, ...centroid(fp), footprint: fp });
}
buildings.sort((a, b) => a.name.localeCompare(b.name));
garages.sort((a, b) => a.name.localeCompare(b.name));

// --- lots ---
const rawLots = read<LotAttrs>("parkinglots.raw.json").filter((f) => f.geometry && f.attributes.precinct === "Main Campus");
const byName = groupBy(rawLots, (f) => f.attributes.lot_name ?? "");
const lots: LotGeo[] = CAMPUS_LOTS.map((name) => {
  const parts = byName.get(name);
  if (!parts) throw new Error(`Lot not found in GIS data: ${name}`);
  const fp = footprintOf(parts);
  const a = parts[0]!.attributes;
  return { id: `lot-${slug(name)}`, name: titleCase(name).replace(/\bAda\b/, "ADA"), number: a.lot_number, status: a.status ?? "Unknown", ...centroid(fp), footprint: fp };
});

const out = (f: string, v: unknown) => writeFileSync(new URL(`../src/data/${f}`, import.meta.url), JSON.stringify(v));
out("buildings.json", buildings);
out("lots.geo.json", lots);
out("garages.geo.json", garages);

const byCat = groupBy(buildings, (b) => b.category);
console.log(`buildings: ${buildings.length}`, Object.fromEntries([...byCat].map(([k, v]) => [k, v.length])));
console.log(`lots: ${lots.length}, garages: ${garages.length}`);
