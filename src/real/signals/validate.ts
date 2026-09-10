import { validCoord, type Coord } from "../core.ts";
import { parseTimestampMs } from "./freshness.ts";
import {
  CROSSING_GEOMETRY,
  namespacedId,
  type CrossingRecord,
  type Exclusion,
  type FieldObservation,
  type GeometryType,
  type OperatingPlanRecord,
  type OperationMode,
  type ProviderSource,
  type RecordStage,
} from "./schema.ts";

const SOURCES: ProviderSource[] = [
  "tdata",
  "utic",
  "police",
  "mois",
  "national-xls",
  "seoul-spatial",
  "field",
  "synthetic",
];
const STAGES: RecordStage[] = ["raw", "normalized", "verified"];
const GEOM: GeometryType[] = [
  "facility-point",
  "intersection-center",
  "pole",
  "crossing-endpoints",
  "crossing-line",
];
const MODES: OperationMode[] = [
  "fixed",
  "actuated",
  "manual",
  "special",
  "unknown",
];

export function asFinite(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function asString(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s.length > 0 && s.length <= max ? s : null;
}

/** Provider IDs may arrive as numbers in GeoJSON/XLS exports. */
function asId(value: unknown, max = 80): string | null {
  if (typeof value === "number" && Number.isFinite(value))
    return asString(String(value), max);
  return asString(value, max);
}

function coordPair(value: unknown): [unknown, unknown] | null {
  return Array.isArray(value) && value.length >= 2 ? [value[0], value[1]] : null;
}

function coordOf(lon: unknown, lat: unknown): Coord | null {
  if (lon === "" || lat === "" || lon == null || lat == null) return null;
  const c: Coord = [Number(lon), Number(lat)];
  return validCoord(c) ? c : null;
}

export function validateCrossing(raw: Record<string, unknown>): {
  ok: CrossingRecord | null;
  reason: string | null;
} {
  const source = asString(raw.source) as ProviderSource | null;
  if (!source || !SOURCES.includes(source))
    return { ok: null, reason: "unknown_source" };
  const sourceCrossingId = asId(raw.sourceCrossingId, 80);
  const sourceIntersectionId = asId(raw.sourceIntersectionId, 80);
  if (!sourceCrossingId || !sourceIntersectionId)
    return { ok: null, reason: "missing_source_ids" };
  const geometryType = asString(raw.geometryType) as GeometryType | null;
  if (!geometryType || !GEOM.includes(geometryType))
    return { ok: null, reason: "unknown_geometryType" };
  const entryPair = coordPair(raw.entryCoord);
  const exitPair = coordPair(raw.exitCoord);
  const entry = coordOf(raw.entryLon ?? entryPair?.[0], raw.entryLat ?? entryPair?.[1]);
  const exit = coordOf(raw.exitLon ?? exitPair?.[0], raw.exitLat ?? exitPair?.[1]);
  if (CROSSING_GEOMETRY.includes(geometryType) && (!entry || !exit))
    return { ok: null, reason: "missing_entry_exit" };
  if (!CROSSING_GEOMETRY.includes(geometryType)) {
    const point = coordOf(raw.lon, raw.lat) ?? entry;
    if (!point) return { ok: null, reason: "missing_facility_coord" };
  }
  const pedestrianSignalGroupId = asId(raw.pedestrianSignalGroupId, 80);
  if (CROSSING_GEOMETRY.includes(geometryType) && !pedestrianSignalGroupId)
    return { ok: null, reason: "missing_pedestrian_signal_group" };
  const crossingLengthM = asFinite(raw.crossingLengthM, 1, 80);
  if (CROSSING_GEOMETRY.includes(geometryType) && crossingLengthM === null)
    return { ok: null, reason: "invalid_crossingLengthM" };
  const paintedWidthM =
    raw.paintedWidthM === "" || raw.paintedWidthM == null
      ? null
      : asFinite(raw.paintedWidthM, 0.5, 20);
  if (raw.paintedWidthM != null && raw.paintedWidthM !== "" && paintedWidthM === null)
    return { ok: null, reason: "invalid_paintedWidthM" };
  if (
    crossingLengthM !== null &&
    paintedWidthM !== null &&
    Math.abs(crossingLengthM - paintedWidthM) < 1e-6
  )
    return { ok: null, reason: "crossingLengthM_equals_paintedWidth_check_direction" };
  const bearingDeg = asFinite(raw.bearingDeg, 0, 360);
  const label = asString(raw.directionLabel ?? raw.travelLabel, 40);
  if (CROSSING_GEOMETRY.includes(geometryType) && (bearingDeg === null || !label))
    return { ok: null, reason: "missing_travel_direction" };
  const stage = (asString(raw.stage) as RecordStage | null) ?? "raw";
  if (!STAGES.includes(stage)) return { ok: null, reason: "unknown_stage" };
  const synthetic = raw.synthetic === true || raw.synthetic === "true";
  if (source === "synthetic" && !synthetic)
    return { ok: null, reason: "synthetic_source_unmarked" };
  const stageIndex = asFinite(raw.stageIndex, 1, 8) ?? 1;
  const stageCount = asFinite(raw.stageCount, 1, 8) ?? 1;
  if (stageIndex > stageCount) return { ok: null, reason: "stageIndex_gt_stageCount" };
  const record: CrossingRecord = {
    stage,
    synthetic,
    source,
    sourceCrossingId,
    sourceIntersectionId,
    internalId: namespacedId(source, sourceCrossingId),
    entryCoord: entry ?? (coordOf(raw.lon, raw.lat) as Coord),
    exitCoord: exit ?? (coordOf(raw.lon, raw.lat) as Coord),
    travel: {
      bearingDeg: bearingDeg ?? 0,
      label: label ?? "unspecified",
    },
    pedestrianSignalGroupId: pedestrianSignalGroupId ?? "",
    crossingLengthM: crossingLengthM ?? 0,
    paintedWidthM,
    geometryType,
    hasRefugeIsland: raw.hasRefugeIsland === true || raw.hasRefugeIsland === "true",
    stageIndex,
    stageCount,
    evidence: Array.isArray(raw.evidence)
      ? (raw.evidence as CrossingRecord["evidence"])
      : [],
    planVerifiedAt: parseTimestampMs(raw.planVerifiedAt),
    observedAt: parseTimestampMs(raw.observedAt),
    fetchedAt: parseTimestampMs(raw.fetchedAt),
    currentPlanConfirmedAt: parseTimestampMs(raw.currentPlanConfirmedAt),
  };
  return { ok: record, reason: null };
}

export function validatePlan(raw: Record<string, unknown>): {
  ok: OperatingPlanRecord | null;
  reason: string | null;
} {
  const source = asString(raw.source) as ProviderSource | null;
  if (!source || !SOURCES.includes(source))
    return { ok: null, reason: "unknown_source" };
  const sourcePlanId = asId(raw.sourcePlanId, 80);
  const version = asId(raw.version, 40);
  const sourceIntersectionId = asId(raw.sourceIntersectionId, 80);
  const pedestrianSignalGroupId = asId(raw.pedestrianSignalGroupId, 80);
  if (!sourcePlanId || !version || !sourceIntersectionId || !pedestrianSignalGroupId)
    return { ok: null, reason: "missing_plan_ids" };
  const cycleSec = asFinite(raw.cycleSec, 20, 240);
  const entryStartSec = asFinite(raw.entryStartSec, 0, 240);
  const entryEndSec = asFinite(raw.entryEndSec, 0, 240);
  const clearEndSec = asFinite(raw.clearEndSec, 0, 240);
  const epochMs = asFinite(raw.epochMs, 0, 1e15);
  const validFromMs = asFinite(raw.validFromMs, 0, 1e15);
  const validToMs = asFinite(raw.validToMs, 0, 1e15);
  const uncertaintySec = asFinite(raw.uncertaintySec, 0, 3);
  if (
    cycleSec === null ||
    entryStartSec === null ||
    entryEndSec === null ||
    clearEndSec === null ||
    epochMs === null ||
    validFromMs === null ||
    validToMs === null ||
    uncertaintySec === null
  )
    return { ok: null, reason: "invalid_plan_numbers" };
  if (entryEndSec <= entryStartSec || clearEndSec < entryEndSec || clearEndSec > cycleSec)
    return { ok: null, reason: "invalid_green_clearance_window" };
  const operationMode = (asString(raw.operationMode) as OperationMode | null) ?? "unknown";
  if (!MODES.includes(operationMode)) return { ok: null, reason: "unknown_operationMode" };
  const startHm = asString(raw.startHm, 5) ?? "00:00";
  const endHm = asString(raw.endHm, 5) ?? "24:00";
  if (!/^\d{2}:\d{2}$/.test(startHm) || !/^\d{2}:\d{2}$/.test(endHm))
    return { ok: null, reason: "invalid_time_band" };
  const synthetic = raw.synthetic === true || raw.synthetic === "true";
  if (source === "synthetic" && !synthetic)
    return { ok: null, reason: "synthetic_source_unmarked" };
  const flash =
    raw.flashStartSec === "" || raw.flashStartSec == null
      ? null
      : asFinite(raw.flashStartSec, 0, 240);
  const weekdays = Array.isArray(raw.weekdays)
    ? raw.weekdays.map(Number).filter((d) => d >= 1 && d <= 7)
    : String(raw.weekdays ?? "")
        .split(/[|,]/)
        .map((s) => Number(s.trim()))
        .filter((d) => d >= 1 && d <= 7);
  const specialDayIds = Array.isArray(raw.specialDayIds)
    ? raw.specialDayIds.map(String)
    : String(raw.specialDayIds ?? "")
        .split(/[|,]/)
        .map((s) => s.trim())
        .filter(Boolean);
  return {
    ok: {
      stage: ((asString(raw.stage) as RecordStage | null) ?? "raw") as RecordStage,
      synthetic,
      source,
      sourcePlanId,
      version,
      sourceIntersectionId,
      pedestrianSignalGroupId,
      cycleSec,
      epochMs,
      entryStartSec,
      entryEndSec,
      flashStartSec: flash,
      clearEndSec,
      validFromMs,
      validToMs,
      apply: {
        timeZone: "Asia/Seoul",
        weekdays,
        startHm,
        endHm,
        specialDayIds,
        appliesOnUnlistedSpecialDay: false,
      },
      uncertaintySec,
      operationMode,
      evidence: Array.isArray(raw.evidence)
        ? (raw.evidence as OperatingPlanRecord["evidence"])
        : [],
      planVerifiedAt: parseTimestampMs(raw.planVerifiedAt),
      observedAt: parseTimestampMs(raw.observedAt),
      fetchedAt: parseTimestampMs(raw.fetchedAt),
      currentPlanConfirmedAt: parseTimestampMs(raw.currentPlanConfirmedAt),
    },
    reason: null,
  };
}

export function validateObservation(raw: Record<string, unknown>): {
  ok: FieldObservation | null;
  reason: string | null;
} {
  const crossingInternalId = asId(raw.crossingInternalId, 120);
  const sourceIntersectionId = asId(raw.sourceIntersectionId, 80);
  const dateSeoul = asString(raw.dateSeoul, 10);
  if (!crossingInternalId || !sourceIntersectionId || !dateSeoul)
    return { ok: null, reason: "missing_observation_keys" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateSeoul))
    return { ok: null, reason: "invalid_dateSeoul" };
  const deviceClockErrorSec = asFinite(raw.deviceClockErrorSec, -120, 120);
  if (deviceClockErrorSec === null) return { ok: null, reason: "invalid_deviceClockErrorSec" };
  const predictedWaitSec =
    raw.predictedWaitSec === "" || raw.predictedWaitSec == null
      ? null
      : asFinite(raw.predictedWaitSec, 0, 300);
  const observedWaitSec =
    raw.observedWaitSec === "" || raw.observedWaitSec == null
      ? null
      : asFinite(raw.observedWaitSec, 0, 300);
  if (raw.predictedWaitSec && predictedWaitSec === null)
    return { ok: null, reason: "invalid_predictedWaitSec" };
  if (raw.observedWaitSec && observedWaitSec === null)
    return { ok: null, reason: "invalid_observedWaitSec" };
  return {
    ok: {
      synthetic: raw.synthetic === true || raw.synthetic === "true",
      crossingInternalId,
      sourceIntersectionId,
      dateSeoul,
      timeBand: asString(raw.timeBand, 40) ?? "",
      specialDayId: asString(raw.specialDayId, 40) ?? "",
      deviceClockErrorSec,
      greenStartMs: parseTimestampMs(raw.greenStartMs) ?? parseTimestampMs(raw.greenStart),
      flashStartMs: parseTimestampMs(raw.flashStartMs) ?? parseTimestampMs(raw.flashStart),
      redStartMs: parseTimestampMs(raw.redStartMs) ?? parseTimestampMs(raw.redStart),
      arrivedEntryMs: parseTimestampMs(raw.arrivedEntryMs) ?? parseTimestampMs(raw.arrivedEntry),
      predictedWaitSec,
      observedWaitSec,
      sourceResponseAtMs:
        parseTimestampMs(raw.sourceResponseAtMs) ?? parseTimestampMs(raw.sourceResponseAt),
      exceptionOperation:
        raw.exceptionOperation === true ||
        raw.exceptionOperation === "true" ||
        raw.exceptionOperation === "Y",
      notes: asString(raw.notes, 500) ?? "",
    },
    reason: null,
  };
}

export function collectValidated<T>(
  rows: Record<string, unknown>[],
  parse: (raw: Record<string, unknown>) => { ok: T | null; reason: string | null },
): { records: T[]; exclusions: Exclusion[] } {
  const records: T[] = [];
  const exclusions: Exclusion[] = [];
  rows.forEach((row, i) => {
    const r = parse(row);
    if (!r.ok) {
      exclusions.push({
        row: i + 2,
        reason: r.reason ?? "invalid",
        sourceId: String(row.sourceCrossingId ?? row.sourcePlanId ?? ""),
      });
      return;
    }
    records.push(r.ok);
  });
  return { records, exclusions };
}
