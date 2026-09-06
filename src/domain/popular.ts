import type { PlaceRef, PopularRouteCard, SavedRoute } from "./models.ts";
import type { PlaceProvider } from "../providers/contracts/index.ts";
import { formatPaceMarks, travelSeconds } from "./pace.ts";

export function statsFromSavedRoute(route: SavedRoute): {
  averagePaceSeconds: number | null;
  elapsedSeconds: number | null;
} {
  const pace = route.averagePaceSeconds && route.averagePaceSeconds > 0 ? route.averagePaceSeconds : null;
  return {
    averagePaceSeconds: pace,
    elapsedSeconds: pace && route.lengthM > 0 ? Math.round(travelSeconds(route.lengthM, pace)) : null,
  };
}

export function resolveRouteEnds(
  places: PlaceProvider,
  route: SavedRoute,
): { origin: PlaceRef; destination: PlaceRef } | null {
  const originByLabel = places.search(route.regionId, route.originLabel)[0];
  const destByLabel = places.search(route.regionId, route.destinationLabel)[0];
  if (originByLabel && destByLabel) return { origin: originByLabel, destination: destByLabel };
  const start = route.geometry[0];
  const end = route.geometry[route.geometry.length - 1];
  if (!start || !end) return null;
  return {
    origin: places.fromPoint(route.regionId, start, route.originLabel),
    destination: places.fromPoint(route.regionId, end, route.destinationLabel),
  };
}

export function cardFromSavedRoute(
  route: SavedRoute,
  origin: PlaceRef,
  destination: PlaceRef,
  authorName: string,
  authorAccountId: string,
): PopularRouteCard {
  return {
    cardId: `upload:${route.routeId}`,
    regionId: route.regionId,
    title: route.title,
    sampleLikeBase: 0,
    directedEdgeIds: route.directedEdgeIds,
    lengthM: route.lengthM,
    signalCount: 0,
    origin,
    destination,
    source: "demo",
    sampleLabel: "올린 루트",
    authorName,
    authorAccountId,
    sourceRouteId: route.routeId,
    ...statsFromSavedRoute(route),
  };
}

export function formatPopularElapsed(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "정보 없음";
  }
  const clamped = Math.round(totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  if (minutes <= 0) return `${seconds}초`;
  if (seconds === 0) return `${minutes}분`;
  return `${minutes}분 ${String(seconds).padStart(2, "0")}초`;
}

export function formatPopularPace(paceSeconds: number | null | undefined): string {
  if (paceSeconds === null || paceSeconds === undefined || !Number.isFinite(paceSeconds) || paceSeconds <= 0) {
    return "정보 없음";
  }
  return formatPaceMarks(paceSeconds);
}

export function hydratePopularCard(
  card: PopularRouteCard,
  route: SavedRoute | null | undefined,
): PopularRouteCard {
  if (!route) return card;
  return { ...card, ...statsFromSavedRoute(route) };
}

export function refreshOwnerPopularStats(
  card: PopularRouteCard,
  ownerId: string | undefined,
  route: SavedRoute | null | undefined,
): PopularRouteCard {
  if (!ownerId || !route || card.authorAccountId !== ownerId) return card;
  return hydratePopularCard(card, route);
}

export function popularRunSummary(card: PopularRouteCard): {
  author: string;
  elapsed: string;
  pace: string;
  recordNote: string;
} {
  return {
    author: card.authorName,
    elapsed: formatPopularElapsed(card.elapsedSeconds),
    pace: formatPopularPace(card.averagePaceSeconds),
    recordNote: card.authorAccountId ? "올린 루트의 평균 기록" : "샘플 기록 · 실제 완주 기록이 아닙니다",
  };
}

export function popularCardSubtitle(card: PopularRouteCard): string {
  const run = popularRunSummary(card);
  return `${run.author} · 돌파 ${run.elapsed} · ${run.pace}`;
}

export function sortPopularByLikes(
  cards: PopularRouteCard[],
  likeCount: (card: PopularRouteCard) => number,
): PopularRouteCard[] {
  return [...cards].sort((a, b) => {
    const diff = likeCount(b) - likeCount(a);
    if (diff !== 0) return diff;
    return a.title.localeCompare(b.title, "ko");
  });
}
