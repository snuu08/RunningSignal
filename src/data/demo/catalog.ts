import { DEMO_OPEN_PACE_SECONDS } from "../../config/app.ts";
import { enumeratePaths } from "../../domain/pathfinding.ts";
import type { PopularRouteCard, RegionId } from "../../domain/models.ts";
import { travelSeconds } from "../../domain/pace.ts";
import { NETWORKS } from "./networks.ts";
import { DEMO_PLANS } from "./signals.ts";

function card(
  regionId: RegionId,
  cardId: string,
  title: string,
  originId: string,
  destId: string,
  sampleLikeBase: number,
): PopularRouteCard {
  const network = NETWORKS[regionId];
  const origin = network.places.find((p) => p.placeId.endsWith(originId));
  const destination = network.places.find((p) => p.placeId.endsWith(destId));
  if (!origin || !destination) {
    throw new Error(`Missing demo places for ${regionId} ${cardId}`);
  }
  const paths = enumeratePaths(network, origin.nodeId, destination.nodeId, [], 1);
  const path = paths[0];
  const directedEdgeIds = path?.directedEdges.map((e) => e.directedEdgeId) ?? [];
  const signalCount = DEMO_PLANS[regionId].filter((p) =>
    directedEdgeIds.includes(p.directedEdgeId),
  ).length;
  return {
    cardId: `${regionId}:${cardId}`,
    regionId,
    title,
    sampleLikeBase,
    directedEdgeIds,
    lengthM: path?.lengthM ?? 0,
    signalCount,
    origin,
    destination,
    source: "demo",
    sampleLabel: "샘플 인기 루트",
    authorName: "샘플",
    authorAccountId: null,
    sourceRouteId: null,
    averagePaceSeconds: DEMO_OPEN_PACE_SECONDS,
    elapsedSeconds:
      path && path.lengthM > 0 ? Math.round(travelSeconds(path.lengthM, DEMO_OPEN_PACE_SECONDS)) : null,
  };
}

export const SAMPLE_CARDS: PopularRouteCard[] = [
  card("seoul", "cafe-hall", "카페거리에서 시청", "cafe", "hall", 24),
  card("seoul", "river", "한강 다리 왕편", "riverN", "riverS", 18),
  card("seoul", "park", "공원 쉼터 한 바퀴", "cafe", "park", 11),
  card("incheon", "cafe-hall", "개항로에서 광장", "cafe", "hall", 16),
  card("incheon", "coast", "해안 산책", "riverN", "riverS", 21),
  card("daegu", "downtown", "동성로에서 시청", "cafe", "hall", 19),
  card("daegu", "stream", "신천 건너기", "riverN", "riverS", 14),
  card("seongnam", "cafe-hall", "서현에서 시청", "cafe", "hall", 13),
  card("seongnam", "stream", "탄천 산책", "riverN", "riverS", 17),
];
