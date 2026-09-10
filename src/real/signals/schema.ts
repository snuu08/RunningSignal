import type { Coord } from "../core.ts";

export type RecordStage = "raw" | "normalized" | "verified";

export type GeometryType =
  | "facility-point"
  | "intersection-center"
  | "pole"
  | "crossing-endpoints"
  | "crossing-line";

export type TravelDirection = {
  /** Degrees clockwise from north, entry → exit. */
  bearingDeg: number;
  /** Compass label from the source document, not inferred from a name. */
  label: string;
};

export type OperationMode =
  | "fixed"
  | "actuated"
  | "manual"
  | "special"
  | "unknown";

export type ProviderSource =
  | "tdata"
  | "utic"
  | "police"
  | "mois"
  | "national-xls"
  | "seoul-spatial"
  | "field"
  | "synthetic";

/** Provider IDs stay namespaced. Never merge by intersection name or nearest point. */
export function namespacedId(source: ProviderSource, sourceId: string): string {
  return `${source}:${sourceId}`;
}

export type Evidence = {
  kind: "document" | "response" | "field-photo" | "field-note" | "synthetic";
  note: string;
  url?: string;
  atMs?: number;
};

export type CrossingRecord = {
  stage: RecordStage;
  synthetic: boolean;
  source: ProviderSource;
  sourceCrossingId: string;
  sourceIntersectionId: string;
  internalId: string;
  entryCoord: Coord;
  exitCoord: Coord;
  travel: TravelDirection;
  pedestrianSignalGroupId: string;
  /** Distance along the runner's crossing path. Not painted stripe width. */
  crossingLengthM: number;
  /** Optional painted width; never used as crossingLengthM. */
  paintedWidthM: number | null;
  geometryType: GeometryType;
  hasRefugeIsland: boolean;
  stageIndex: number;
  stageCount: number;
  evidence: Evidence[];
  planVerifiedAt: number | null;
  observedAt: number | null;
  fetchedAt: number | null;
  currentPlanConfirmedAt: number | null;
};

export type TimeBandRule = {
  timeZone: "Asia/Seoul";
  /** ISO weekday 1=Mon … 7=Sun. Empty means no weekday filter. */
  weekdays: number[];
  startHm: string;
  endHm: string;
  /** Special-day ids must be listed. Never inferred from the calendar. */
  specialDayIds: string[];
  appliesOnUnlistedSpecialDay: false;
};

export type OperatingPlanRecord = {
  stage: RecordStage;
  synthetic: boolean;
  source: ProviderSource;
  sourcePlanId: string;
  version: string;
  sourceIntersectionId: string;
  pedestrianSignalGroupId: string;
  cycleSec: number;
  epochMs: number;
  entryStartSec: number;
  entryEndSec: number;
  flashStartSec: number | null;
  clearEndSec: number;
  validFromMs: number;
  validToMs: number;
  apply: TimeBandRule;
  uncertaintySec: number;
  operationMode: OperationMode;
  evidence: Evidence[];
  planVerifiedAt: number | null;
  observedAt: number | null;
  fetchedAt: number | null;
  currentPlanConfirmedAt: number | null;
};

export type FieldObservation = {
  synthetic: boolean;
  crossingInternalId: string;
  sourceIntersectionId: string;
  dateSeoul: string;
  timeBand: string;
  specialDayId: string;
  deviceClockErrorSec: number;
  greenStartMs: number | null;
  flashStartMs: number | null;
  redStartMs: number | null;
  arrivedEntryMs: number | null;
  predictedWaitSec: number | null;
  observedWaitSec: number | null;
  sourceResponseAtMs: number | null;
  exceptionOperation: boolean;
  notes: string;
};

export type Exclusion = {
  row: number;
  reason: string;
  sourceId?: string;
};

export const CROSSING_GEOMETRY: GeometryType[] = [
  "crossing-endpoints",
  "crossing-line",
];

export function isCrossingGeometry(
  t: string,
): t is "crossing-endpoints" | "crossing-line" {
  return t === "crossing-endpoints" || t === "crossing-line";
}
