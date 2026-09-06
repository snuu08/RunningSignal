import {
  SEARCH_EXPAND_LIMIT,
  SEARCH_PATH_LIMIT,
  SEARCH_TIME_BUDGET_MS,
} from "../config/app.ts";
import { directedEdgeId, fingerprintFromEdges, parseDirectedEdgeId } from "./fingerprint.ts";
import { reverseGeometry } from "./geo.ts";
import type {
  DirectedEdge,
  GraphEdge,
  LocalMetersPoint,
  PathCandidate,
  WalkingNetwork,
} from "./models.ts";

export function asDirected(edge: GraphEdge, forward: boolean): DirectedEdge {
  return {
    directedEdgeId: directedEdgeId(edge.id, forward),
    edgeId: edge.id,
    from: forward ? edge.from : edge.to,
    to: forward ? edge.to : edge.from,
    lengthM: edge.lengthM,
    geometry: forward ? edge.geometry : reverseGeometry(edge.geometry),
    walkKind: edge.walkKind,
    isStairs: edge.isStairs,
    isOverpass: edge.isOverpass,
    walkable: edge.walkable,
    geometryVersion: edge.geometryVersion,
  };
}

export function adjacency(network: WalkingNetwork): Map<string, DirectedEdge[]> {
  const map = new Map<string, DirectedEdge[]>();
  const add = (d: DirectedEdge) => {
    const list = map.get(d.from) ?? [];
    list.push(d);
    map.set(d.from, list);
  };
  for (const edge of Object.values(network.edges)) {
    if (!edge.walkable) continue;
    add(asDirected(edge, true));
    add(asDirected(edge, false));
  }
  return map;
}

function isUTurn(prev: DirectedEdge | null, next: DirectedEdge): boolean {
  if (!prev) return false;
  return prev.edgeId === next.edgeId && prev.from === next.to && prev.to === next.from;
}

function passesWaypoints(nodeIds: string[], waypoints: string[]): boolean {
  if (waypoints.length === 0) return true;
  let idx = 0;
  for (const id of nodeIds) {
    if (id === waypoints[idx]) {
      idx += 1;
      if (idx === waypoints.length) return true;
    }
  }
  return false;
}

export function dijkstra(
  network: WalkingNetwork,
  start: string,
  goal: string,
): DirectedEdge[] | null {
  const adj = adjacency(network);
  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; edge: DirectedEdge }>();
  const pq: { node: string; cost: number }[] = [{ node: start, cost: 0 }];
  dist.set(start, 0);

  while (pq.length > 0) {
    pq.sort((a, b) => a.cost - b.cost);
    const cur = pq.shift();
    if (!cur) break;
    if (cur.node === goal) break;
    if ((dist.get(cur.node) ?? Infinity) < cur.cost) continue;
    const prevEdge = prev.get(cur.node)?.edge ?? null;
    for (const edge of adj.get(cur.node) ?? []) {
      if (isUTurn(prevEdge, edge)) continue;
      const next = cur.cost + edge.lengthM;
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        prev.set(edge.to, { node: cur.node, edge });
        pq.push({ node: edge.to, cost: next });
      }
    }
  }

  if (!prev.has(goal) && start !== goal) return null;
  const edges: DirectedEdge[] = [];
  let cursor = goal;
  while (cursor !== start) {
    const step = prev.get(cursor);
    if (!step) return null;
    edges.push(step.edge);
    cursor = step.node;
  }
  edges.reverse();
  return edges;
}

function candidateFromEdges(edges: DirectedEdge[], id: string): PathCandidate {
  const nodeIds = edges.length === 0 ? [] : [edges[0].from, ...edges.map((e) => e.to)];
  const geometry = edges.flatMap((e, i) => (i === 0 ? e.geometry : e.geometry.slice(1)));
  const lengthM = edges.reduce((s, e) => s + e.lengthM, 0);
  return {
    id,
    directedEdges: edges,
    nodeIds,
    lengthM,
    geometry,
    fingerprint: fingerprintFromEdges(edges),
    viaLabel: "",
  };
}

export function enumeratePaths(
  network: WalkingNetwork,
  start: string,
  goal: string,
  waypoints: string[],
  seed: number,
): PathCandidate[] {
  const adj = adjacency(network);
  const started = Date.now();
  const found: PathCandidate[] = [];
  const seen = new Set<string>();
  let expansions = 0;

  const shortest = dijkstra(network, start, goal);
  const shortestLen = shortest?.reduce((s, e) => s + e.lengthM, 0) ?? Infinity;
  const maxLen = Number.isFinite(shortestLen) ? shortestLen * 1.85 : Infinity;

  const stack: { node: string; path: DirectedEdge[]; nodes: Set<string> }[] = [
    { node: start, path: [], nodes: new Set([start]) },
  ];

  while (stack.length > 0) {
    if (found.length >= SEARCH_PATH_LIMIT) break;
    if (expansions >= SEARCH_EXPAND_LIMIT) break;
    if (Date.now() - started > SEARCH_TIME_BUDGET_MS) break;
    expansions += 1;
    const cur = stack.pop();
    if (!cur) break;
    if (cur.node === goal) {
      if (!passesWaypoints([start, ...cur.path.map((e) => e.to)], waypoints)) continue;
      const cand = candidateFromEdges(cur.path, `p${found.length}-${seed}`);
      if (seen.has(cand.fingerprint)) continue;
      seen.add(cand.fingerprint);
      found.push(cand);
      continue;
    }
    const neighbors = [...(adj.get(cur.node) ?? [])];
    neighbors.sort((a, b) => {
      const jitter = ((seed + a.directedEdgeId.length) % 7) - 3;
      return a.lengthM - b.lengthM + jitter;
    });
    const prev = cur.path[cur.path.length - 1] ?? null;
    for (const edge of neighbors) {
      if (isUTurn(prev, edge)) continue;
      if (cur.nodes.has(edge.to)) continue;
      const nextLen = cur.path.reduce((s, e) => s + e.lengthM, 0) + edge.lengthM;
      if (nextLen > maxLen) continue;
      const nodes = new Set(cur.nodes);
      nodes.add(edge.to);
      stack.push({ node: edge.to, path: [...cur.path, edge], nodes });
    }
  }

  if (shortest && shortest.length > 0) {
    const base = candidateFromEdges(shortest, `p-short-${seed}`);
    if (!seen.has(base.fingerprint) && passesWaypoints(base.nodeIds, waypoints)) {
      found.unshift(base);
    }
  }

  return found;
}

export function geometryFromDirectedIds(
  network: WalkingNetwork,
  ids: string[],
): LocalMetersPoint[] {
  const points: LocalMetersPoint[] = [];
  for (const id of ids) {
    const parsed = parseDirectedEdgeId(id);
    const edge = network.edges[parsed.edgeId];
    if (!edge) continue;
    const directed = asDirected(edge, parsed.forward);
    if (points.length === 0) points.push(...directed.geometry);
    else points.push(...directed.geometry.slice(1));
  }
  return points;
}

export function pathThroughStops(
  network: WalkingNetwork,
  stopNodeIds: string[],
): { directedEdges: DirectedEdge[]; lengthM: number; geometry: LocalMetersPoint[] } | null {
  if (stopNodeIds.length < 2) return null;
  const directedEdges: DirectedEdge[] = [];
  for (let i = 0; i < stopNodeIds.length - 1; i += 1) {
    const from = stopNodeIds[i];
    const to = stopNodeIds[i + 1];
    if (from === to) continue;
    const segment = dijkstra(network, from, to);
    if (!segment || segment.length === 0) return null;
    directedEdges.push(...segment);
  }
  if (directedEdges.length === 0) return null;
  const geometry = directedEdges.flatMap((edge, index) =>
    index === 0 ? edge.geometry : edge.geometry.slice(1),
  );
  const lengthM = directedEdges.reduce((sum, edge) => sum + edge.lengthM, 0);
  return { directedEdges, lengthM, geometry };
}

export function snapToNearestNode(
  network: WalkingNetwork,
  x: number,
  y: number,
): string {
  let best = Object.keys(network.nodes)[0];
  let bestD = Infinity;
  for (const node of Object.values(network.nodes)) {
    const d = Math.hypot(node.point.x - x, node.point.y - y);
    if (d < bestD) {
      bestD = d;
      best = node.id;
    }
  }
  return best;
}
