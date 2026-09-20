import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Public VT Facilities GIS layer. Kept local at runtime so routing remains deterministic/offline-friendly. */
const URL = "https://arcgis-central.gis.vt.edu/arcgis/rest/services/facilities/EmergencyAccessMappingLayers/FeatureServer/7/query?where=1%3D1&outFields=ada_status&returnGeometry=true&outSR=4326&f=geojson";
const out = resolve(import.meta.dirname, "../../src/data/walkways.geo.json");

const response = await fetch(URL);
if (!response.ok) throw new Error(`VT sidewalk layer request failed: ${response.status}`);
const data = await response.json() as { type?: string; features?: unknown[] };
if (data.type !== "FeatureCollection" || !Array.isArray(data.features) || !data.features.length) throw new Error("VT sidewalk layer returned no GeoJSON features");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(data)}\n`);
console.log(`wrote ${data.features.length} VT sidewalk/pathway features to ${out}`);
