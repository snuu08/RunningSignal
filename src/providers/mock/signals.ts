import { DEMO_PLANS, createSignalLookup } from "../../data/demo/signals.ts";
import type { SignalProvider } from "../contracts/index.ts";

export function createMockSignals(): SignalProvider {
  return {
    capability() {
      return "fixed-plan";
    },
    lookup(regionId) {
      return createSignalLookup(DEMO_PLANS[regionId]);
    },
    list(regionId) {
      return DEMO_PLANS[regionId];
    },
  };
}
