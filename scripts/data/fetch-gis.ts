/**
 * One-time pull of VT's public ArcGIS layers into data/raw/ (WGS84). Run manually:
 *   node scripts/data/fetch-gis.ts
 * After this, every other script reads the local files; the live endpoint is never called at runtime.
 */
import { writeFileSync } from "node:fs";

const BASE = "https://arcgis-central.gis.vt.edu/arcgis/rest/services/vtcampusmap";
const LAYERS = { Buildings: "buildings.raw.json", ParkingLots: "parkinglots.raw.json" } as const;

for (const [layer, file] of Object.entries(LAYERS)) {
  const qs = new URLSearchParams({ where: "1=1", outFields: "*", outSR: "4326", returnGeometry: "true", f: "json" });
  const res = await fetch(`${BASE}/${layer}/FeatureServer/0/query?${qs}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${layer}: HTTP ${res.status}`);
  const json = (await res.json()) as { features?: unknown[]; exceededTransferLimit?: boolean };
  if (!json.features?.length) throw new Error(`${layer}: no features returned`);
  if (json.exceededTransferLimit) throw new Error(`${layer}: result truncated, add paging`);
  writeFileSync(new URL(`../../data/raw/${file}`, import.meta.url), JSON.stringify(json));
  console.log(`${layer}: ${json.features.length} features -> data/raw/${file}`);
}
