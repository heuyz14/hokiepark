import type { Footprint } from "../types.ts";

/**
 * A `Footprint` is a flat list of rings; multi-part buildings/lots store each disjoint part as
 * its own ring (see scripts/data/build-data.ts), not as a hole in a single polygon. So each ring
 * becomes its own one-ring GeoJSON Polygon inside the MultiPolygon, never a hole.
 */
export function footprintToGeoJSON(fp: Footprint): GeoJSON.MultiPolygon {
  return { type: "MultiPolygon", coordinates: fp.map((ring) => [ring]) };
}

/** [[minLon,minLat],[maxLon,maxLat]] envelope of every vertex - input to maplibre's fitBounds. */
export function footprintBounds(fp: Footprint): [[number, number], [number, number]] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const ring of fp) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}
