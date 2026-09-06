import { createBrowserStore, type LocalStore } from "../../storage/local-store.ts";
import type { ProviderBundle } from "../contracts/index.ts";
import { createMockAuth } from "./auth.ts";
import { createMockCatalog } from "./catalog.ts";
import { createMockPlaces } from "./places.ts";
import { createProfileStore, createMockRuns } from "./runs.ts";
import { createMockRoutes } from "./routes.ts";
import { createSettingsStore } from "./settings.ts";
import { createMockSignals } from "./signals.ts";

export function createProviders(store: LocalStore = createBrowserStore()): ProviderBundle {
  const auth = createMockAuth(store);
  const signals = createMockSignals();
  return {
    auth,
    profiles: createProfileStore(store),
    settings: createSettingsStore(store),
    places: createMockPlaces(),
    routes: createMockRoutes(signals),
    signals,
    location: {
      kind: "simulation",
      note: "GPS 없이 경로 위 보간으로 이동합니다. 실제 위치 기록이 아닙니다.",
      subscribe() {
        return { unsubscribe() {} };
      },
    },
    catalog: createMockCatalog(store),
    runs: createMockRuns(store),
  };
}
