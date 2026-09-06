import { routeFingerprint } from "../../domain/fingerprint.ts";
import { geometryFromDirectedIds } from "../../domain/pathfinding.ts";
import type { RegionId, SavedRoute } from "../../domain/models.ts";
import { SAMPLE_CARDS } from "./catalog.ts";
import { NETWORKS } from "./networks.ts";

export function buildDemoSavedRoute(accountId: string, regionId: RegionId): SavedRoute | null {
  const card =
    SAMPLE_CARDS.find((item) => item.regionId === regionId) ??
    SAMPLE_CARDS.find((item) => item.regionId === "seoul");
  if (!card || card.directedEdgeIds.length === 0 || card.lengthM <= 0) return null;
  return {
    routeId: `demo-sample:${accountId}:${card.cardId}`,
    accountId,
    title: card.title,
    fingerprint: routeFingerprint(card.directedEdgeIds, 1),
    directedEdgeIds: card.directedEdgeIds,
    geometry: geometryFromDirectedIds(NETWORKS[card.regionId], card.directedEdgeIds),
    geometryVersion: 1,
    lengthM: card.lengthM,
    regionId: card.regionId,
    originLabel: card.origin.label,
    destinationLabel: card.destination.label,
    source: "demo",
    createdAt: Date.now(),
    recentSessionId: null,
    averagePaceSeconds: 360,
  };
}
