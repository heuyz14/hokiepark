import { haversineMeters, type Located } from "./nearby.ts";

/** A small, deterministic pedestrian graph. Add vetted campus paths here when available. */
export interface WalkNode extends Located {
  id: string;
}

export interface WalkEdge {
  from: string;
  to: string;
  distanceMeters: number;
  accessible?: boolean;
}

export interface WalkGraph {
  nodes: Record<string, WalkNode>;
  adjacency: Record<string, WalkEdge[]>;
}

export interface WalkRoute {
  distanceMeters: number;
  durationSeconds: number;
  geometry: WalkNode[];
  originSnapDistanceMeters: number;
  destinationSnapDistanceMeters: number;
}

export const DEFAULT_WALKING_SPEED_MPS = 1.3;

export function findNearestWalkNode(point: Located, graph: WalkGraph): WalkNode {
  const nodes = Object.values(graph.nodes);
  if (!nodes.length) throw new Error("walk_graph_empty");
  return nodes.reduce((best, node) => haversineMeters(point, node) < haversineMeters(point, best) ? node : best);
}

/** A* over non-negative, directed pedestrian edges. Returns null when graph areas are disconnected. */
export function calculateWalkRoute(origin: Located, destination: Located, graph: WalkGraph): WalkRoute | null {
  const start = findNearestWalkNode(origin, graph);
  const goal = findNearestWalkNode(destination, graph);
  const open = new Set([start.id]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[start.id, 0]]);
  const fScore = new Map<string, number>([[start.id, haversineMeters(start, goal)]]);

  while (open.size) {
    const currentId = [...open].sort((a, b) => (fScore.get(a) ?? Infinity) - (fScore.get(b) ?? Infinity))[0]!;
    if (currentId === goal.id) {
      const ids = [currentId];
      while (cameFrom.has(ids[0]!)) ids.unshift(cameFrom.get(ids[0]!)!);
      const graphDistance = gScore.get(goal.id)!;
      const originSnapDistanceMeters = haversineMeters(origin, start);
      const destinationSnapDistanceMeters = haversineMeters(goal, destination);
      const distanceMeters = graphDistance + originSnapDistanceMeters + destinationSnapDistanceMeters;
      return { distanceMeters: Math.round(distanceMeters), durationSeconds: Math.round(distanceMeters / DEFAULT_WALKING_SPEED_MPS), geometry: ids.map((id) => graph.nodes[id]!), originSnapDistanceMeters: Math.round(originSnapDistanceMeters), destinationSnapDistanceMeters: Math.round(destinationSnapDistanceMeters) };
    }
    open.delete(currentId);
    for (const edge of graph.adjacency[currentId] ?? []) {
      if (edge.distanceMeters < 0 || !graph.nodes[edge.to]) continue;
      const tentative = (gScore.get(currentId) ?? Infinity) + edge.distanceMeters;
      if (tentative >= (gScore.get(edge.to) ?? Infinity)) continue;
      cameFrom.set(edge.to, currentId);
      gScore.set(edge.to, tentative);
      fScore.set(edge.to, tentative + haversineMeters(graph.nodes[edge.to]!, goal));
      open.add(edge.to);
    }
  }
  return null;
}
