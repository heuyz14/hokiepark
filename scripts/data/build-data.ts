/**
 * Phase 0: flatten the raw VT ArcGIS responses (data/raw/*.json, fetched once by
 * scripts/data/fetch-gis.ts) into the flat shapes the app consumes. Never hits the network.
 *
 * Selection is rule-based so it is reproducible, not the spec's hand-picked 92:
 *   buildings: four VT categories, existing, inside CORE_BOX, footprint >= MIN_AREA,
 *              plus LANDMARK_NUMS regardless of box. Multi-part buildings are merged by bldg_num.
 *   lots:      every "Main Campus"-precinct lot in VT's own ParkingLots layer (polygons merged
 *              by name), i.e. all of them - minus EXCLUDED_LOTS, which are literally driveways/
 *              loading docks caught in the same layer, not places a driver would park; and minus
 *              REMOTE_LOTS, real lots that are still miles from the walkable campus this app (and
 *              its BUILDINGS list) models - the airport (~1.4 mi SE) and the Plantation Road
 *              research farm (~1 mi S) - where "nearest building, N min walk" would be nonsense.
 *              "CRC" precinct (~17 lots) is Corporate Research Center, a satellite office park
 *              ~1.5 mi south with the same problem, so it's left out along with it.
 *              `Shape__Area` (real GIS polygon area, sq ft) is carried through so lots.ts can
 *              derive a realistic capacity per lot instead of guessing dozens of numbers by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Building, BuildingCategory, Footprint, GarageGeo, LotGeo, Ring } from "../../src/types.ts";

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
  Shape__Area: number;
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
/** GIS entries that are driveways/loading docks, not a place a driver would park. */
const EXCLUDED_LOTS = new Set([
  "Cowgill Service Drive", "Career Services Service Drive", "Pritchard Service Drive",
  "Litton Reaves Service Drive", "Hitt Hall Service and Loading Dock",
]);
/** Real VT lots, but miles from the walkable campus (see file header). */
const REMOTE_LOTS = new Set(["Airport Hangar", "Airport Terminal", "Plantation Research"]);

const read = <A>(f: string) =>
  (JSON.parse(readFileSync(new URL(`../../data/raw/${f}`, import.meta.url), "utf8")) as { features: EsriFeature<A>[] }).features;

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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
const lots: LotGeo[] = [...byName.keys()]
  .filter((name) => name && !EXCLUDED_LOTS.has(name) && !REMOTE_LOTS.has(name))
  .map((name) => {
    const parts = byName.get(name)!;
    const fp = footprintOf(parts);
    const a = parts[0]!.attributes;
    const areaSqFt = parts.reduce((s, p) => s + p.attributes.Shape__Area, 0);
    // VT's own lot_name is already correctly cased (McComas, CMMID/COHR, WARE Lab, ...); don't reprocess it.
    return { id: `lot-${slug(name)}`, name, number: a.lot_number, status: a.status ?? "Unknown", ...centroid(fp), footprint: fp, areaSqFt: Math.round(areaSqFt) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const out = (f: string, v: unknown) => writeFileSync(new URL(`../../src/data/${f}`, import.meta.url), JSON.stringify(v));
out("buildings.json", buildings);
out("lots.geo.json", lots);
out("garages.geo.json", garages);

const byCat = groupBy(buildings, (b) => b.category);
console.log(`buildings: ${buildings.length}`, Object.fromEntries([...byCat].map(([k, v]) => [k, v.length])));
console.log(`lots: ${lots.length}, garages: ${garages.length}`);
