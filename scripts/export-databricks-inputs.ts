/**
 * Writes the small input files the Databricks notebooks need next to the timetable: databricks/data/garages.json and
 * databricks/data/building_points.json. Run: npm run databricks:inputs (databricks/tests/test_parity.py fails if stale).
 * databricks/upload/ is refreshed with all five files the notebooks read.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { copyFileSync, mkdirSync } from "node:fs";
import { GARAGES } from "../src/data/garages.ts";
import { LOTS } from "../src/data/lots.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const codes = read("../data/timetable-building-codes.json") as Record<string, { num: string }>;
const gis = read("../data/raw/buildings.raw.json").features as { attributes: { bldg_num: string; latitude: number; longitude: number } }[];

const wanted = new Set(Object.values(codes).map((c) => c.num));
const points: Record<string, { lat: number; lon: number }> = {};
for (const f of gis) {
  const a = f.attributes;
  if (wanted.has(a.bldg_num) && !(a.bldg_num in points)) points[a.bldg_num] = { lat: a.latitude, lon: a.longitude };
}
const garages = GARAGES.map((g) => ({ id: g.id, name: g.name, lat: g.lat, lon: g.lon, levels: g.levels.map((l) => ({ label: l.label, classes: l.classes, capacity: l.capacity })) }));

const out = (name: string, v: unknown) => writeFileSync(new URL(`../databricks/data/${name}`, import.meta.url), JSON.stringify(v, null, 1) + "\n");
// One row per place a car can park: every garage LEVEL (permit-specific, bottom-up fill) and every lot. Capacity of lots is
// derived from real GIS polygon area (see src/data/lots.ts); it is not a published count.
const units = [
  ...GARAGES.flatMap((g) =>
    g.levels.map((l, i) => ({ id: `${g.id}:${i}`, name: `${g.name} - ${l.label}`, kind: "garage-level", garage_id: g.id, level_index: i, capacity: l.capacity, classes: l.classes, lat: g.lat, lon: g.lon })),
  ),
  ...LOTS.map((l) => ({ id: l.id, name: l.name, kind: "lot", garage_id: null, level_index: null, capacity: l.capacity, classes: l.classes, lat: l.lat, lon: l.lon })),
];

out("garages.json", garages);
out("building_points.json", points);
out("units.json", units);

// Everything the notebooks read from the Unity Catalog volume, in one folder (git-ignored) so it can be dragged in at once.
mkdirSync(new URL("../databricks/upload/", import.meta.url), { recursive: true });
for (const f of ["data/raw/timetable.json", "data/timetable-building-codes.json", "databricks/data/building_points.json", "databricks/data/garages.json", "databricks/data/units.json"]) {
  copyFileSync(new URL(`../${f}`, import.meta.url), new URL(`../databricks/upload/${f.split("/").pop()}`, import.meta.url));
}
console.log(`wrote databricks/data: ${garages.length} garages, ${units.length} units (${units.filter((u) => u.kind === "lot").length} lots), ${Object.keys(points).length} building points; refreshed databricks/upload/`);
