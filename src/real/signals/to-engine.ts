import type { Crossing, FixedPlan } from "../core.ts";
import { appliedPlanIsFresh, engineVerifiedAtMs } from "./freshness.ts";
import { isCrossingGeometry, type CrossingRecord, type OperatingPlanRecord } from "./schema.ts";

/**
 * Runtime forecast input. Facility points never become crossings.
 * Actuated/manual/special/unknown modes keep plan=null (no future prediction).
 * verifiedAtMs is currentPlanConfirmedAt only.
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
  const ts = plan
    ? {
        planVerifiedAt: plan.planVerifiedAt,
        observedAt: plan.observedAt,
        fetchedAt: plan.fetchedAt,
        currentPlanConfirmedAt: plan.currentPlanConfirmedAt,
      }
    : {
        planVerifiedAt: crossing.planVerifiedAt,
        observedAt: crossing.observedAt,
        fetchedAt: crossing.fetchedAt,
        currentPlanConfirmedAt: crossing.currentPlanConfirmedAt,
      };
  const confirmed = engineVerifiedAtMs(ts);
  if (
    !plan ||
    plan.operationMode !== "fixed" ||
    plan.stage !== "verified" ||
    plan.synthetic ||
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
    cycleSec: plan.cycleSec,
    epochMs: plan.epochMs,
    entryStartSec: plan.entryStartSec,
    entryEndSec: plan.entryEndSec,
    clearEndSec: plan.clearEndSec,
    validFromMs: plan.validFromMs,
    validToMs: plan.validToMs,
    verifiedAtMs: confirmed,
    uncertaintySec: plan.uncertaintySec,
  };
  return {
    id: crossing.internalId,
    name: crossing.travel.label,
    atM,
    widthM: crossing.crossingLengthM,
    plan: runtime,
  };
}
