import {
  applyWalkingPolicy,
  forecast,
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
import {
  TRIAL_ROUTING_POLICY,
  type RealRoutingPolicy,
} from "../src/real/routing-policy.ts";

/** Implement this boundary only after pedestrian direction, plan epoch and coverage are verified. */
/** Verified records live under data/signals/verified. Do not auto-load samples. */
export interface RouteSignalProvider {
  inspect(
    route: Route,
    departureMs: number,
  ): Promise<{
    completeCoverage: boolean;
    crossings: Crossing[];
    source: string;
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
) {
  const entries = await Promise.all(
    routes.map(async (route) => {
      try {
        const result = await provider.inspect(route, departureMs);
        return {
          route,
          forecast: forecast(
            route.distanceM,
            pace,
            departureMs,
            result.crossings,
            result.completeCoverage,
            Date.now(),
          ),
        };
      } catch {
        return {
          route,
          forecast: forecast(
            route.distanceM,
            pace,
            departureMs,
            [],
            false,
            Date.now(),
          ),
        };
      }
    }),
  );
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
  return {
    recommendedId,
    recommendationReason: reason,
    forecasts,
    signalCoverage: coverageOf(entries.map((e) => e.forecast)),
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
  return {
    emptyReason: walking.emptyReason,
    routes: orderWithRecommended(walking.routes, recommendedId),
    assessment: {
      ...assessment,
      recommendedId,
      recommendationReason:
        recommendedId && recommendedId !== walking.routes[0]?.id
          ? ("signal-compare" as const)
          : assessment.recommendationReason,
    },
  };
}
