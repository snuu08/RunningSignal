import type { AvoidanceCheck, Forecast, Route } from "./core.ts";
import type { RealRoutingPolicy } from "./routing-policy.ts";

export type RecommendationReason = "walking-baseline" | "signal-compare";
export type SignalCoverage = "unknown" | "partial" | "complete";

export type RoutesResponse = {
  routes: Route[];
  partial: boolean;
  recommendedId: string | null;
  recommendationReason: RecommendationReason;
  recommendSentences?: string[];
  forecasts: Record<string, Forecast>;
  departureMs: number;
  signalCoverage: SignalCoverage;
  policyApplied: RealRoutingPolicy;
  avoidanceCheck?: AvoidanceCheck;
};

export type SignalReadiness = {
  configured: { seoul: boolean; utic: boolean; national: boolean };
  reachable: { seoul: boolean | null; utic: null; national: null };
  mappingReady: boolean;
  predictionReady: boolean;
  predictionByRegion: Record<string, boolean>;
};

export type StatusResponse = {
  places: boolean;
  routes: boolean;
  seoulSignals: boolean;
  reverseGeocode: boolean;
  signalPrediction: boolean;
  signalDetail: string;
  signal: SignalReadiness;
  utic: { configured: boolean; ready: boolean; detail: string };
  national: { configured: boolean; ready: boolean; detail: string };
};

export function candidateIndex(
  routes: { id: string }[],
  recommendedId: string | null,
): number {
  if (!recommendedId) return 0;
  const i = routes.findIndex((r) => r.id === recommendedId);
  return i >= 0 ? i : 0;
}

/** Parsed T-DATA current state for diagnostics. Remaining is never seconds. */
export type CurrentSignalView = {
  itstId: string | null;
  sourceTimestampMs: number | null;
  fetchedAtMs: number;
  sourceAgeMs: number | null;
  stale: boolean;
  missingSourceTime: boolean;
  pedestrian: {
    key: string;
    direction: string;
    kind: "pedestrian" | "vehicle";
    statusName: string;
  }[];
  vehicle: {
    key: string;
    direction: string;
    kind: "pedestrian" | "vehicle";
    statusName: string;
  }[];
  remainingPedestrian: {
    key: string;
    direction: string;
    raw: number | null;
    seconds: null;
    unit: string;
    missing: boolean;
  }[];
  pedestrianPresent: boolean;
  remainingPresent: boolean;
  notes: string[];
};

export function remainingRawDisplay(raw: number | null): string {
  if (raw === null) return "잔여값 없음";
  return `원본 ${raw} (단위 미확인 · 초가 아님)`;
}

export function isCurrentSignalView(value: unknown): value is CurrentSignalView {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as CurrentSignalView).pedestrian) &&
    Array.isArray((value as CurrentSignalView).notes)
  );
}

/** Unknown wait is not 0. Only an explicit known waitSec is shown as seconds. */
export function waitDisplay(forecast?: Forecast | null): {
  known: boolean;
  waitSec: number | null;
  stops: number | null;
  totalSec: number | null;
} {
  if (
    !forecast ||
    forecast.waitSec === null ||
    forecast.stops === null ||
    forecast.maxWaitSec === null
  ) {
    return { known: false, waitSec: null, stops: null, totalSec: null };
  }
  return {
    known: true,
    waitSec: forecast.waitSec,
    stops: forecast.stops,
    totalSec: forecast.totalSec,
  };
}

export function orderWithRecommended<T extends { id: string }>(
  routes: T[],
  recommendedId: string | null,
): T[] {
  const i = recommendedId
    ? routes.findIndex((r) => r.id === recommendedId)
    : -1;
  if (i <= 0) return routes;
  return [routes[i], ...routes.filter((_, j) => j !== i)];
}
