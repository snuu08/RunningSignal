import type {
  AuthProvider,
  LocationProvider,
  PlaceProvider,
  RouteCatalogProvider,
  RouteProvider,
  SignalProvider,
} from "../contracts/index.ts";

export class RealAdapterNotReadyError extends Error {
  constructor(area: string) {
    super(
      `${area} 실제 어댑터가 아직 연결되지 않았습니다. 데모 모드로 전환해 가상 데이터만 사용하세요. 실제 지도와 가상 신호를 섞지 않습니다.`,
    );
    this.name = "RealAdapterNotReadyError";
  }
}

export const realAuthProvider: AuthProvider = {
  listAccounts: () => [],
  signUp: async () => {
    throw new RealAdapterNotReadyError("auth");
  },
  login: async () => {
    throw new RealAdapterNotReadyError("auth");
  },
  loginDemoGuest: async () => {
    throw new RealAdapterNotReadyError("auth");
  },
  logout: () => undefined,
  currentAccount: () => null,
  requestPasswordReset: async () => {
    throw new RealAdapterNotReadyError("mail");
  },
  resetPassword: async () => {
    throw new RealAdapterNotReadyError("auth");
  },
  peekResetToken: () => null,
};

export const realPlaceProvider: PlaceProvider = {
  search: () => {
    throw new RealAdapterNotReadyError("place");
  },
  getNetwork: () => {
    throw new RealAdapterNotReadyError("map");
  },
  fromNode: () => {
    throw new RealAdapterNotReadyError("place");
  },
  fromPoint: () => {
    throw new RealAdapterNotReadyError("place");
  },
  demoStart: () => {
    throw new RealAdapterNotReadyError("place");
  },
};

export const realRouteProvider: RouteProvider = {
  plan: () => {
    throw new RealAdapterNotReadyError("route");
  },
  planAsync: async () => {
    throw new RealAdapterNotReadyError("route");
  },
};

export const realSignalProvider: SignalProvider = {
  capability: () => "location-only",
  lookup: () => {
    throw new RealAdapterNotReadyError("signal");
  },
  list: () => {
    throw new RealAdapterNotReadyError("signal");
  },
};

export const realLocationProvider: LocationProvider = {
  kind: "device",
  note: "실제 GPS 어댑터는 이번 범위에 없습니다. 사용자 일시정지로 실제 신호 시계를 동결할 수 없습니다.",
  subscribe(onFix) {
    onFix({
      ok: false,
      error: "실제 위치 공급이 연결되어 있지 않습니다.",
      atMs: Date.now(),
    });
    return { unsubscribe() {} };
  },
};

export const realCatalogProvider: RouteCatalogProvider = {
  list: () => {
    throw new RealAdapterNotReadyError("catalog");
  },
  get: () => {
    throw new RealAdapterNotReadyError("catalog");
  },
  liked: () => false,
  toggleLike: () => {
    throw new RealAdapterNotReadyError("catalog");
  },
  displayCount: () => 0,
  publish: () => {
    throw new RealAdapterNotReadyError("catalog");
  },
  renameCard: () => {
    throw new RealAdapterNotReadyError("catalog");
  },
  findBySourceRoute: () => {
    throw new RealAdapterNotReadyError("catalog");
  },
};
