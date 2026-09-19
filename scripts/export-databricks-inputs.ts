/**
 * Writes the small input files the Databricks notebooks need next to the timetable: databricks/data/garages.json and
 * databricks/data/building_points.json. Run: npm run databricks:inputs (databricks/tests/test_parity.py fails if stale).
 * The other inputs are uploaded as-is: data/raw/timetable.json and data/timetable-building-codes.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { GARAGES } from "../src/data/garages.ts";

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
out("garages.json", garages);
out("building_points.json", points);
console.log(`wrote databricks/data: ${garages.length} garages, ${Object.keys(points).length} building points`);
