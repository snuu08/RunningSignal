import type { Crossing, FixedPlan } from "../core.ts";
import { appliedPlanIsFresh, engineVerifiedAtMs } from "./freshness.ts";
import { isCrossingGeometry, type CrossingRecord, type OperatingPlanRecord } from "./schema.ts";

export function planFitsCrossing(
  crossing: CrossingRecord,
  plan: OperatingPlanRecord,
): string | null {
  if (plan.source !== crossing.source) return "plan_source_mismatch";
  if (plan.sourceIntersectionId !== crossing.sourceIntersectionId)
    return "plan_intersection_mismatch";
  if (plan.pedestrianSignalGroupId !== crossing.pedestrianSignalGroupId)
    return "plan_signal_group_mismatch";
  return null;
}

/**
 * Runtime forecast input. Facility points never become crossings.
 * Actuated/manual/special/unknown modes keep plan=null (no future prediction).
 * verifiedAtMs is currentPlanConfirmedAt only.
 * A plan from another intersection or pedestrian group is refused, not merged.
 */
export function toRuntimeCrossing(
  crossing: CrossingRecord,
  plan: OperatingPlanRecord | null,
  nowMs: number,
  atM: number,
): Crossing | null {
  if (!isCrossingGeometry(crossing.geometryType)) return null;
  if (crossing.synthetic) return null;
  if (crossing.stage !== "verified") return null;
  if (!(crossing.crossingLengthM > 0)) return null;
  const mismatch = plan ? planFitsCrossing(crossing, plan) : null;
  const usable = mismatch ? null : plan;
  const ts = usable
    ? {
        planVerifiedAt: usable.planVerifiedAt,
        observedAt: usable.observedAt,
        fetchedAt: usable.fetchedAt,
        currentPlanConfirmedAt: usable.currentPlanConfirmedAt,
      }
    : {
        planVerifiedAt: crossing.planVerifiedAt,
        observedAt: crossing.observedAt,
        fetchedAt: crossing.fetchedAt,
        currentPlanConfirmedAt: crossing.currentPlanConfirmedAt,
      };
  const confirmed = engineVerifiedAtMs(ts);
  if (
    !usable ||
    usable.operationMode !== "fixed" ||
    usable.stage !== "verified" ||
    usable.synthetic ||
    confirmed === null ||
    !appliedPlanIsFresh(confirmed, nowMs)
  ) {
    return {
      id: crossing.internalId,
      name: crossing.travel.label,
      atM,
      widthM: crossing.crossingLengthM,
      plan: null,
    };
  }
  const runtime: FixedPlan = {
    cycleSec: usable.cycleSec,
    epochMs: usable.epochMs,
    entryStartSec: usable.entryStartSec,
    entryEndSec: usable.entryEndSec,
    clearEndSec: usable.clearEndSec,
    validFromMs: usable.validFromMs,
    validToMs: usable.validToMs,
    verifiedAtMs: confirmed,
    uncertaintySec: usable.uncertaintySec,
  };
  return {
    id: crossing.internalId,
    name: crossing.travel.label,
    atM,
    widthM: crossing.crossingLengthM,
    plan: runtime,
  };
}
