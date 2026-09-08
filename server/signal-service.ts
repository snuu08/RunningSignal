import {
  forecast,
  preferSignalRoute,
  type Crossing,
  type Forecast,
  type Route,
} from "../src/real/core.ts";
/** Implement this boundary only after pedestrian direction, plan epoch and coverage are verified. */
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
export async function evaluateSignalCandidates(
  routes: Route[],
  pace: number,
  departureMs: number,
  provider: RouteSignalProvider = unavailableSignals,
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
  return {
    recommendedId: preferSignalRoute(entries)?.route.id ?? null,
    forecasts: Object.fromEntries(
      entries.map((e) => [e.route.id, e.forecast]),
    ) as Record<string, Forecast>,
  };
}
