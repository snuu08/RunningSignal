import { NETWORKS } from "../../data/demo/networks.ts";
import { defaultRoutingPolicy, planRoutes, type RoutingPolicyConfig } from "../../domain/routing-policy.ts";
import type { RouteProvider, SignalProvider } from "../contracts/index.ts";

export function createMockRoutes(signals: SignalProvider): RouteProvider {
  return {
    plan(request, policy?: RoutingPolicyConfig) {
      const network = NETWORKS[request.origin.placeId.split(":")[0] as keyof typeof NETWORKS];
      const regionId = network?.regionId ?? guessRegion(request.origin.placeId);
      return planRoutes(
        request,
        NETWORKS[regionId],
        signals.lookup(regionId),
        policy ?? defaultRoutingPolicy,
      );
    },
    async planAsync(request, signal, policy) {
      if (signal?.aborted) return { error: "경로 찾기가 취소되었습니다." };
      return this.plan(request, policy);
    },
  };
}

function guessRegion(placeId: string): keyof typeof NETWORKS {
  const prefix = placeId.split(":")[0];
  if (prefix in NETWORKS) return prefix as keyof typeof NETWORKS;
  return "seoul";
}
