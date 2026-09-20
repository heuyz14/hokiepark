import walkways from "../data/walkways.geo.json" with { type: "json" };
import { calculateWalkRoute, type WalkEdge, type WalkGraph, type WalkRoute, type WalkRouteOptions } from "./routing.ts";
import type { Located } from "./nearby.ts";

type WalkwayFeature = { geometry?: { type?: string; coordinates?: unknown }; properties?: { ada_status?: string | null } };
type WalkwayData = { features: WalkwayFeature[] };

/**
 * Public Virginia Tech Facilities GIS "Sidewalks and Pathways" data, fetched by
 * `npm run walkways`. Coordinates are canonicalised to about 11 cm, preserving shared
 * vertices while keeping the graph small. Edges are bidirectional pedestrian segments.
 */
function buildWalkGraph(data: WalkwayData): WalkGraph {
  const nodes: WalkGraph["nodes"] = {};
  const adjacency: WalkGraph["adjacency"] = {};
  const nodeId = (lon: number, lat: number) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const addNode = (lon: number, lat: number) => {
    const id = nodeId(lon, lat);
    nodes[id] ??= { id, lat, lon };
    adjacency[id] ??= [];
    return id;
  };
  const distance = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const latScale = 111_320;
    const lonScale = latScale * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    return Math.hypot((a.lat - b.lat) * latScale, (a.lon - b.lon) * lonScale);
  };
  const addEdge = (from: string, to: string, accessible: boolean) => {
    const meters = distance(nodes[from]!, nodes[to]!);
    if (!meters) return;
    const edge: WalkEdge = { from, to, distanceMeters: meters, accessible };
    adjacency[from]!.push(edge);
  };

  for (const feature of data.features) {
    if (feature.geometry?.type !== "LineString" || !Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) continue;
    const points = feature.geometry.coordinates.filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2 && typeof point[0] === "number" && typeof point[1] === "number");
    if (points.length < 2) continue;
    const ids = points.map(([lon, lat]) => addNode(lon, lat));
    const accessible = feature.properties?.ada_status === "Access";
    for (let index = 1; index < ids.length; index++) {
      addEdge(ids[index - 1]!, ids[index]!, accessible);
      addEdge(ids[index]!, ids[index - 1]!, accessible);
    }
  }
  return { nodes, adjacency };
}

export const VT_WALK_GRAPH = buildWalkGraph(walkways as unknown as WalkwayData);
const routeCache = new Map<string, WalkRoute | null>();

/** A deterministic route along VT's published sidewalk/pathway lines, or null when not connected. */
export function calculateCampusWalkingRoute(origin: Located, destination: Located, options: WalkRouteOptions = {}): WalkRoute | null {
  // Most plan renders compare the same fixed lots and buildings repeatedly. Caching preserves
  // determinism and keeps the full comparison within an interactive budget.
  const key = `${origin.lat.toFixed(6)},${origin.lon.toFixed(6)}>${destination.lat.toFixed(6)},${destination.lon.toFixed(6)}:${options.accessibleOnly ? "a" : "s"}`;
  if (routeCache.has(key)) return routeCache.get(key)!;
  const route = calculateWalkRoute(origin, destination, VT_WALK_GRAPH, options);
  routeCache.set(key, route);
  return route;
}
