import { NETWORKS } from "../../data/demo/networks.ts";
import { planRoutes } from "../../domain/routing-policy.ts";
import type { RouteProvider, SignalProvider } from "../contracts/index.ts";

export function createMockRoutes(signals: SignalProvider): RouteProvider {
  return {
    plan(request) {
      const network = NETWORKS[request.origin.placeId.split(":")[0] as keyof typeof NETWORKS];
      const regionId = network?.regionId ?? guessRegion(request.origin.placeId);
      return planRoutes(request, NETWORKS[regionId], signals.lookup(regionId));
    },
  };
}

function guessRegion(placeId: string): keyof typeof NETWORKS {
  const prefix = placeId.split(":")[0];
  if (prefix in NETWORKS) return prefix as keyof typeof NETWORKS;
  return "seoul";
}
