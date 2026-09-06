import { asDirected } from "../../domain/pathfinding.ts";
import type { CrossingPlan, RegionId, WalkingNetwork } from "../../domain/models.ts";
import { NETWORKS } from "./networks.ts";

function findDirected(
  network: WalkingNetwork,
  from: string,
  to: string,
): string | null {
  for (const edge of Object.values(network.edges)) {
    if (edge.from === from && edge.to === to) return asDirected(edge, true).directedEdgeId;
    if (edge.from === to && edge.to === from) return asDirected(edge, false).directedEdgeId;
  }
  return null;
}

function plan(
  crossingId: string,
  directedEdgeId: string,
  label: string,
  network: WalkingNetwork,
  nodeId: string,
  referenceTimeSec: number,
  extras?: Partial<CrossingPlan>,
): CrossingPlan {
  const node = network.nodes[nodeId];
  return {
    crossingId,
    directedEdgeId,
    label,
    point: node.point,
    crossingWidthM: 18,
    cycleSeconds: 90,
    referenceTimeSec,
    greenEntryWindow: { startSec: 0, endSec: 25 },
    clearanceWindow: { startSec: 25, endSec: 32 },
    planValidity: { validFromSec: null, validToSec: null },
    source: "demo",
    freshness: "fresh",
    uncertaintySec: 0,
    capability: "fixed-plan",
    ...extras,
  };
}

/**
 * Seoul long-wait fixture: 6:00/km over 720m arrives at 259.2s.
 * reference 204.2 → cycle position 55 → 35s wait for the southbound crossing.
 */
const SEOUL_LONG_WAIT_REF = 259.2 - 55;

function buildPlans(regionId: RegionId): CrossingPlan[] {
  const network = NETWORKS[regionId];
  const south = findDirected(network, "n:1600:160", "n:1600:480");
  const east = findDirected(network, "n:1240:160", "n:1600:160");
  const bridgeS = findDirected(network, "n:520:800", "n:520:1120");
  const hallWest = findDirected(network, "n:1240:480", "n:1600:480");
  const phase = regionId === "seoul" ? SEOUL_LONG_WAIT_REF : regionId === "incheon" ? 40 : regionId === "daegu" ? 10 : 70;

  const plans: CrossingPlan[] = [];
  if (south) {
    plans.push(
      plan(`${regionId}-hall-s`, south, "시청 앞 횡단", network, "n:1600:160", phase),
    );
  }
  if (east) {
    plans.push(
      plan(`${regionId}-cafe-e`, east, "카페거리 동쪽 횡단", network, "n:1240:160", 0),
    );
  }
  if (bridgeS) {
    plans.push(
      plan(`${regionId}-bridge`, bridgeS, "강변 다리 횡단", network, "n:520:800", 12),
    );
  }
  if (hallWest) {
    plans.push(
      plan(`${regionId}-hall-w`, hallWest, "시청 서쪽 횡단", network, "n:1240:480", 8),
    );
  }
  return plans;
}

export const DEMO_PLANS: Record<RegionId, CrossingPlan[]> = {
  seoul: buildPlans("seoul"),
  incheon: buildPlans("incheon"),
  daegu: buildPlans("daegu"),
  seongnam: buildPlans("seongnam"),
};

export function createSignalLookup(
  plans: CrossingPlan[],
  unknownDirectedIds: string[] = [],
) {
  const map = new Map(plans.map((p) => [p.directedEdgeId, p]));
  const unknown = new Set(unknownDirectedIds);
  return {
    get(directedEdgeId: string) {
      if (unknown.has(directedEdgeId)) return "unknown" as const;
      return map.get(directedEdgeId) ?? null;
    },
  };
}
