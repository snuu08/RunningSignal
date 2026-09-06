import type { DirectedEdge } from "./models.ts";

export function directedEdgeId(edgeId: string, forward: boolean): string {
  return forward ? `${edgeId}>` : `${edgeId}<`;
}

export function parseDirectedEdgeId(id: string): { edgeId: string; forward: boolean } {
  const forward = id.endsWith(">");
  return { edgeId: id.slice(0, -1), forward };
}

export function routeFingerprint(
  directedEdgeIds: string[],
  geometryVersion: number,
): string {
  return `v${geometryVersion}|${directedEdgeIds.join(">")}`;
}

export function fingerprintFromEdges(edges: DirectedEdge[]): string {
  const version = edges[0]?.geometryVersion ?? 1;
  return routeFingerprint(
    edges.map((e) => e.directedEdgeId),
    version,
  );
}

export function reverseFingerprint(fingerprint: string): string {
  const [version, rest] = fingerprint.split("|");
  if (!rest) return fingerprint;
  const parts = rest.split(">").filter(Boolean);
  const reversed = [...parts].reverse().map((id) => {
    if (id.endsWith(">")) return `${id.slice(0, -1)}<`;
    if (id.endsWith("<")) return `${id.slice(0, -1)}>`;
    return id;
  });
  return `${version}|${reversed.join(">")}`;
}
