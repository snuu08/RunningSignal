import type {
  AuthAccount,
  CrossingPlan,
  DemoMail,
  DepartureBasis,
  LocalMetersPoint,
  PlaceRef,
  PopularRouteCard,
  Recommendation,
  RegionId,
  ResetToken,
  RouteRequest,
  RunSession,
  SavedRoute,
  SignalCapability,
  UserAppSettings,
  UserProfile,
  WalkingNetwork,
} from "../../domain/models.ts";
import type { RoutingPolicyConfig } from "../../domain/routing-policy.ts";

export type AuthProvider = {
  listAccounts(): AuthAccount[];
  signUp(email: string, password: string): Promise<AuthAccount>;
  login(email: string, password: string, persist: boolean): Promise<AuthAccount>;
  loginDemoGuest(): Promise<AuthAccount>;
  logout(): void;
  currentAccount(): AuthAccount | null;
  requestPasswordReset(email: string): Promise<{ mail: DemoMail | null }>;
  resetPassword(token: string, password: string): Promise<void>;
  peekResetToken(token: string): ResetToken | null;
};

export type ProfileStore = {
  get(accountId: string): UserProfile;
  save(profile: Partial<UserProfile> & { accountId: string }): void;
};

export type SettingsStore = {
  get(accountId: string): UserAppSettings;
  save(accountId: string, patch: Partial<UserAppSettings>): UserAppSettings | null;
};

export type PlaceProvider = {
  search(regionId: RegionId, query: string): PlaceRef[];
  getNetwork(regionId: RegionId): WalkingNetwork;
  fromNode(regionId: RegionId, nodeId: string, label?: string): PlaceRef;
  fromPoint(regionId: RegionId, point: LocalMetersPoint, label: string): PlaceRef;
  demoStart(regionId: RegionId): PlaceRef;
};

export type RouteProvider = {
  plan(
    request: RouteRequest,
    policy?: RoutingPolicyConfig,
  ): Recommendation | { error: string };
  planAsync(
    request: RouteRequest,
    signal?: AbortSignal,
    policy?: RoutingPolicyConfig,
  ): Promise<Recommendation | { error: string }>;
};

export type SignalProvider = {
  capability(): SignalCapability;
  lookup(regionId: RegionId): {
    get(directedEdgeId: string): CrossingPlan | "unknown" | null;
  };
  list(regionId: RegionId): CrossingPlan[];
};

export type LocationFix =
  | { ok: true; point: LocalMetersPoint; atMs: number; source: "simulation" | "device" }
  | { ok: false; error: string; atMs: number };

export type LocationSubscription = {
  unsubscribe(): void;
};

export type LocationProvider = {
  kind: "simulation" | "device";
  note: string;
  subscribe(onFix: (fix: LocationFix) => void): LocationSubscription;
};

export type RouteCatalogProvider = {
  list(regionId: RegionId): PopularRouteCard[];
  get(cardId: string): PopularRouteCard | null;
  liked(accountId: string, cardId: string): boolean;
  toggleLike(accountId: string, cardId: string): { liked: boolean; displayCount: number };
  displayCount(accountId: string, card: PopularRouteCard): number;
  publish(card: PopularRouteCard): PopularRouteCard;
  renameCard(accountId: string, cardId: string, title: string): PopularRouteCard | null;
  findBySourceRoute(routeId: string): PopularRouteCard | null;
};

export type RunRepository = {
  listRoutes(accountId: string): SavedRoute[];
  listSessions(accountId: string, routeId: string): RunSession[];
  saveSession(
    accountId: string,
    session: RunSession,
    route: Omit<SavedRoute, "recentSessionId">,
  ): { route: SavedRoute; session: RunSession };
  getRoute(accountId: string, routeId: string): SavedRoute | null;
  renameRoute(accountId: string, routeId: string, title: string): SavedRoute | null;
  deleteRoute(accountId: string, routeId: string): void;
  setRouteAveragePace(accountId: string, routeId: string, paceSeconds: number | null): SavedRoute | null;
  ensureDemoSample(accountId: string, regionId: RegionId): SavedRoute | null;
  listAllSessions(accountId: string): RunSession[];
  deleteAllRuns(accountId: string): void;
  writeSnapshot(accountId: string, session: RunSession | null): void;
  readSnapshot(accountId: string): RunSession | null;
};

export type ProviderBundle = {
  auth: AuthProvider;
  profiles: ProfileStore;
  settings: SettingsStore;
  places: PlaceProvider;
  routes: RouteProvider;
  signals: SignalProvider;
  location: LocationProvider;
  catalog: RouteCatalogProvider;
  runs: RunRepository;
};

export type DeparturePlanner = {
  clockStart(atSec: number): DepartureBasis;
  demoSignalAligned(crossingId: string, atSec: number): DepartureBasis;
};
