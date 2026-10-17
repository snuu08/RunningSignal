import {
  applyWalkingPolicy,
  forecastRemaining,
  preferSignalRoute,
  type Crossing,
  type Forecast,
  type Route,
} from "../src/real/core.ts";
import {
  orderWithRecommended,
  type RecommendationReason,
  type SignalCoverage,
} from "../src/real/api-contract.ts";
import { recommendSentences } from "../src/real/recommend-copy.ts";
import {
  TRIAL_ROUTING_POLICY,
  type RealRoutingPolicy,
} from "../src/real/routing-policy.ts";

/** Only verified pedestrian geometry, timing semantics and surveyed coverage enter forecasts. */
/** Verified records live under data/signals/verified. Do not auto-load samples. */
export interface RouteSignalProvider {
  inspect(
    route: Route,
    departureMs: number,
    context?: { paceSecPerKm: number; traveledM: number },
  ): Promise<{
    completeCoverage: boolean;
    crossings: Crossing[];
    source: string;
    exclusions?: { id: string; reason: string }[];
    retryAfterMs?: number | null;
  }>;
}
export const unavailableSignals: RouteSignalProvider = {
  async inspect() {
    return { completeCoverage: false, crossings: [], source: "unverified" };
  },
};

function coverageOf(forecasts: Forecast[]): SignalCoverage {
  if (!forecasts.length) return "unknown";
  const known = forecasts.filter((f) => f.waitSec !== null);
  if (!known.length) return "unknown";
  if (known.length === forecasts.length) return "complete";
  return "partial";
}

export async function evaluateSignalCandidates(
  routes: Route[],
  pace: number,
  departureMs: number,
  provider: RouteSignalProvider = unavailableSignals,
  policy: RealRoutingPolicy = TRIAL_ROUTING_POLICY,
  progressByRoute: Record<string, number> = {},
) {
  const inspected = await Promise.all(
    routes.map(async (route) => {
      try {
        const result = await provider.inspect(route, departureMs,
          { paceSecPerKm: pace, traveledM: progressByRoute[route.id] ?? 0 });
        return { route, crossings: result.crossings, completeCoverage: result.completeCoverage,
          retryAfterMs: result.retryAfterMs ?? null };
      } catch {
        return { route, crossings: [] as Crossing[], completeCoverage: false };
      }
    }),
  );
  // All candidates share the clock after signal responses finish. A newly
  // received source timestamp must not look "from the future" relative to the
  // request start, and network time must not be charged as running time.
  const evaluatedAtMs = Date.now();
  const actualDepartureMs = Math.max(departureMs, evaluatedAtMs);
  const retryAfterMs = Math.max(0, ...inspected.map((r) => "retryAfterMs" in r ? r.retryAfterMs ?? 0 : 0));
  const entries = inspected.map(({ route, crossings, completeCoverage }) => ({
    route,
    forecast: forecastRemaining(
      route.distanceM, pace, actualDepartureMs, crossings, completeCoverage,
      progressByRoute[route.id] ?? 0, evaluatedAtMs,
    ),
  }));
  const pick = preferSignalRoute(entries, policy);
  const baselineId = entries[0]?.route.id ?? null;
  const recommendedId = pick?.route.id ?? baselineId;
  const reason: RecommendationReason =
    recommendedId && recommendedId !== baselineId
      ? "signal-compare"
      : "walking-baseline";
  const forecasts = Object.fromEntries(
    entries.map((e) => [e.route.id, e.forecast]),
  ) as Record<string, Forecast>;
  const signalCoverage = coverageOf(entries.map((e) => e.forecast));
  const chosen = entries.find((e) => e.route.id === recommendedId)?.route ?? routes[0];
  const chosenEntry = entries.find((e) => e.route.id === recommendedId);
  const baseline = entries[0];
  const waitSavedSec =
    baseline?.forecast.waitSec != null && chosenEntry?.forecast.waitSec != null
      ? baseline.forecast.waitSec - chosenEntry.forecast.waitSec
      : null;
  const extraMForCopy =
    reason === "signal-compare" && baseline
      ? Math.max(0, chosen.distanceM - baseline.route.distanceM)
      : (chosen?.extraM ?? 0);
  return {
    recommendedId,
    recommendationReason: reason,
    forecasts,
    signalCoverage,
    paceSecPerKm: pace,
    departureMs: actualDepartureMs,
    refreshAfterMs: Math.max(5000, retryAfterMs),
    recommendSentences: recommendSentences({
      reason,
      coverage: signalCoverage,
      liveSignals: reason === "signal-compare",
      extraM: extraMForCopy,
      sharpTurns: chosen?.sharpTurns ?? 0,
      waitSavedSec,
    }),
  };
}

export async function planReturnedRoutes(
  routes: Route[],
  pace: number,
  departureMs: number,
  policy: RealRoutingPolicy,
  provider: RouteSignalProvider = unavailableSignals,
) {
  const walking = applyWalkingPolicy(routes, policy);
  if (!walking.routes.length) return { ...walking, assessment: null };
  const assessment = await evaluateSignalCandidates(
    walking.routes,
    pace,
    departureMs,
    provider,
    policy,
  );
  const recommendedId =
    assessment.recommendedId &&
    walking.routes.some((r) => r.id === assessment.recommendedId)
      ? assessment.recommendedId
      : (walking.routes[0]?.id ?? null);
  const reason: RecommendationReason =
    recommendedId && recommendedId !== walking.routes[0]?.id
      ? "signal-compare"
      : assessment.recommendationReason;
  const chosen =
    walking.routes.find((r) => r.id === recommendedId) ?? walking.routes[0];
  const baseline = walking.routes[0];
  const baselineForecast = baseline ? assessment.forecasts[baseline.id] : null;
  const chosenForecast = chosen ? assessment.forecasts[chosen.id] : null;
  const waitSavedSec =
    baselineForecast?.waitSec != null && chosenForecast?.waitSec != null
      ? baselineForecast.waitSec - chosenForecast.waitSec
      : null;
  const extraMForCopy =
    reason === "signal-compare" && baseline && chosen
      ? Math.max(0, chosen.distanceM - baseline.distanceM)
      : (chosen?.extraM ?? 0);
  return {
    emptyReason: walking.emptyReason,
    avoidance: walking.avoidance,
    routes: orderWithRecommended(walking.routes, recommendedId),
    assessment: {
      ...assessment,
      recommendedId,
      recommendationReason: reason,
      recommendSentences: recommendSentences({
        reason,
        coverage: assessment.signalCoverage,
        liveSignals: reason === "signal-compare",
        extraM: extraMForCopy,
        sharpTurns: chosen?.sharpTurns ?? 0,
        waitSavedSec,
      }),
    },
  };
}
