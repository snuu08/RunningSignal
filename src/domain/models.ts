export const REGION_IDS = ["seoul", "incheon", "daegu", "seongnam"] as const;
export type RegionId = (typeof REGION_IDS)[number];

export type DataSource = "demo" | "real";
export type CoordSystem = "local-meters" | "wgs84";

export type LocalMetersPoint = {
  system: "local-meters";
  x: number;
  y: number;
};

export type Wgs84Point = {
  system: "wgs84";
  lat: number;
  lon: number;
};

export type GeoPoint = LocalMetersPoint | Wgs84Point;

export type WalkKind = "sidewalk" | "park_path" | "alley" | "bridge" | "stairs" | "overpass";

export type RegionCapability = {
  id: RegionId;
  label: string;
  demoAvailable: boolean;
  realCapability: "unsupported";
  demoLabel: string;
};

export type PlaceRef = {
  placeId: string;
  label: string;
  point: LocalMetersPoint;
  nodeId: string;
  source: DataSource;
};

export type GraphNode = {
  id: string;
  point: LocalMetersPoint;
  kind: "intersection" | "place" | "park" | "alley" | "bridge";
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  lengthM: number;
  geometry: LocalMetersPoint[];
  walkable: boolean;
  walkKind: WalkKind;
  isStairs: boolean;
  isOverpass: boolean;
  geometryVersion: number;
};

export type DirectedEdge = {
  directedEdgeId: string;
  edgeId: string;
  from: string;
  to: string;
  lengthM: number;
  geometry: LocalMetersPoint[];
  walkKind: WalkKind;
  isStairs: boolean;
  isOverpass: boolean;
  walkable: boolean;
  geometryVersion: number;
};

export type MapFeature =
  | { kind: "river"; id: string; polygon: LocalMetersPoint[] }
  | { kind: "park"; id: string; polygon: LocalMetersPoint[] }
  | { kind: "block"; id: string; polygon: LocalMetersPoint[] }
  | { kind: "road"; id: string; points: LocalMetersPoint[]; width: number };

export type WalkingNetwork = {
  regionId: RegionId;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  features: MapFeature[];
  places: PlaceRef[];
  demoStartNodeId: string;
  geometryVersion: number;
  source: DataSource;
};

export type SignalCapability =
  | "location-only"
  | "current-state"
  | "fixed-plan"
  | "future-prediction";

export type CrossingPlan = {
  crossingId: string;
  directedEdgeId: string;
  label: string;
  point: LocalMetersPoint;
  crossingWidthM: number;
  cycleSeconds: number;
  referenceTimeSec: number;
  greenEntryWindow: { startSec: number; endSec: number };
  clearanceWindow: { startSec: number; endSec: number };
  planValidity: { validFromSec: number | null; validToSec: number | null };
  source: DataSource;
  freshness: "fresh" | "stale" | "unknown";
  uncertaintySec: number | null;
  capability: SignalCapability;
};

export type SignalLookup = {
  get(directedEdgeId: string): CrossingPlan | "unknown" | null;
};

export type TimeEstimate =
  | { kind: "exact"; seconds: number }
  | { kind: "range"; minSeconds: number; maxSeconds: number }
  | { kind: "unknown" };

export type WaitEstimate =
  | { kind: "exact"; seconds: number; crossing: CrossingPlan }
  | { kind: "unknown"; crossingId?: string; reason: string }
  | { kind: "none" };

export type PaceInput = {
  minutes: number;
  seconds: number;
};

export type DepartureBasis =
  | { kind: "clock-start"; atSec: number }
  | { kind: "demo-signal-aligned"; crossingId: string; atSec: number };

export type RouteRequest = {
  origin: PlaceRef;
  destination: PlaceRef;
  waypoints: PlaceRef[];
  paceSecondsPerKm: number;
  departure: DepartureBasis;
  seed: number;
  nowSec: number;
};

export type PathCandidate = {
  id: string;
  directedEdges: DirectedEdge[];
  nodeIds: string[];
  lengthM: number;
  geometry: LocalMetersPoint[];
  fingerprint: string;
  viaLabel: string;
};

export type CrossingOnPath = {
  directedEdgeId: string;
  arrival: TimeEstimate;
  wait: WaitEstimate;
  departure: TimeEstimate;
};

export type PathEvaluation = {
  candidate: PathCandidate;
  travelSec: TimeEstimate;
  waitSec: TimeEstimate;
  totalSec: TimeEstimate;
  stopCount: number;
  knownCrossingCount: number;
  unknownCrossingCount: number;
  crossings: CrossingOnPath[];
  turnScore: number;
  walkScore: number;
  sharpTurns: number;
  zigzagPairs: number;
  maxExactWaitSec: number | null;
  complete: boolean;
};

export type Recommendation = {
  chosen: PathEvaluation;
  baseline: PathEvaluation;
  alternatives: PathEvaluation[];
  reason: string;
  detourRatioUsed: number;
  waitThresholdSec: number;
};

export type RunPhase = "ready" | "running" | "paused" | "completed";
export type RunningSubState = "moving" | "waitingAtSignal";
export type PauseReason = "manual" | "auto-hidden" | "restored";
export type SaveState = "unsaved" | "saved" | "discarded";
export type CompletionKind = "full" | "partial";

export type RunTimes = {
  movingSec: number;
  signalWaitSec: number;
  manualPauseSec: number;
  totalElapsedSec: number;
};

export type PlannedSnapshot = {
  request: RouteRequest;
  evaluation: PathEvaluation;
};

export type RunSession = {
  sessionId: string;
  accountId: string;
  routeId: string | null;
  title: string;
  source: DataSource;
  phase: RunPhase;
  runningSub: RunningSubState;
  pauseReason: PauseReason | null;
  saveState: SaveState;
  completion: CompletionKind | null;
  planned: PlannedSnapshot;
  actualDirectedEdgeIds: string[];
  progressM: number;
  times: RunTimes;
  simSpeed: 1 | 10 | 30;
  startedAtSec: number | null;
  endedAtSec: number | null;
  createdAt: number;
  justRunSummary?: JustRunSummary | null;
};

export type JustRunSummary = {
  distanceM: number;
  laps: number;
  paceSeconds: number | null;
};

export type SavedRoute = {
  routeId: string;
  accountId: string;
  title: string;
  fingerprint: string;
  directedEdgeIds: string[];
  geometry: LocalMetersPoint[];
  geometryVersion: number;
  lengthM: number;
  regionId: RegionId;
  originLabel: string;
  destinationLabel: string;
  source: DataSource;
  createdAt: number;
  recentSessionId: string | null;
  averagePaceSeconds?: number | null;
};

export type PopularRouteCard = {
  cardId: string;
  regionId: RegionId;
  title: string;
  sampleLikeBase: number;
  directedEdgeIds: string[];
  lengthM: number;
  signalCount: number;
  origin: PlaceRef;
  destination: PlaceRef;
  source: DataSource;
  sampleLabel: string;
};

export type AuthAccount = {
  id: string;
  email: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: number;
  isDemoGuest: boolean;
};

export type PaceBook = {
  usual: number | null;
  fiveK: number | null;
  tenK: number | null;
  half: number | null;
  full: number | null;
};

export type PaceSlotId = keyof PaceBook;

export type UserProfile = {
  accountId: string;
  regionId: RegionId | null;
  nickname: string | null;
  onboarded: boolean;
  profileSetupCompleted: boolean;
  paces: PaceBook;
};

export type DemoMail = {
  id: string;
  toEmail: string;
  subject: string;
  createdAt: number;
  resetToken: string;
};

export type ResetToken = {
  token: string;
  accountId: string;
  expiresAt: number;
  used: boolean;
};
