import { appliedPlanIsFresh } from "./freshness.ts";
import { isCrossingGeometry, type CrossingRecord, type OperatingPlanRecord } from "./schema.ts";
import { planAppliesAt } from "./select-plan.ts";
import { planFitsCrossing } from "./to-engine.ts";
import type { PredictionScope, VerifiedBundle } from "./provider.ts";

export type PredictionExclusionReason =
  | "missing_crossing"
  | "missing_geometry"
  | "missing_direction"
  | "missing_signal_group"
  | "missing_width"
  | "missing_plan"
  | "missing_epoch"
  | "stale_plan"
  | "scope_inactive"
  | "survey_incomplete"
  | "plan_mismatch"
  | "plan_not_fixed"
  | "synthetic"
  | "stage_unverified";

export type SignalAuditReport = {
  crossingsTotal: number;
  crossingsVerified: number;
  plansTotal: number;
  plansVerified: number;
  directionMapped: number;
  epochKnown: number;
  widthKnown: number;
  surveyCovered: number;
  predictionEligible: number;
  predictionExcluded: number;
  excludedReasons: Record<PredictionExclusionReason, number>;
  predictionReady: false;
  relationship: string[];
};

const RELATIONSHIP = [
  "route",
  "crossing geometry",
  "crossing direction",
  "sourceIntersectionId",
  "pedestrianSignalGroupId",
  "operating plan",
  "cycle / phase / epoch",
  "validity",
];

function add(
  reasons: Set<PredictionExclusionReason>,
  reason: PredictionExclusionReason,
) {
  reasons.add(reason);
}

function scopeAllows(scopes: PredictionScope[], crossing: CrossingRecord) {
  return scopes.some(
    (scope) =>
      scope.source === crossing.source &&
      scope.sourceIntersectionId === crossing.sourceIntersectionId,
  );
}

function crossingDirectionMapped(crossing: CrossingRecord) {
  return (
    Number.isFinite(crossing.travel.bearingDeg) &&
    crossing.travel.label.trim().length > 0 &&
    crossing.travel.label.trim().toLowerCase() !== "unmapped" &&
    crossing.travel.evidence.trim().length > 0
  );
}

function signalGroupMapped(crossing: CrossingRecord) {
  return (
    crossing.pedestrianSignalGroupId.trim().length > 0 &&
    crossing.pedestrianSignalGroupId.trim().toLowerCase() !== "unmapped"
  );
}

function matchingPlan(
  plans: OperatingPlanRecord[],
  crossing: CrossingRecord,
  atMs: number,
) {
  const candidates = plans.filter(
    (plan) =>
      plan.source === crossing.source &&
      plan.sourceIntersectionId === crossing.sourceIntersectionId &&
      plan.pedestrianSignalGroupId === crossing.pedestrianSignalGroupId &&
      planAppliesAt(plan, atMs),
  );
  return candidates.sort((a, b) => b.validFromMs - a.validFromMs)[0] ?? null;
}

function coveredBySurvey(bundle: VerifiedBundle, crossing: CrossingRecord) {
  return bundle.surveys.some(
    (survey) =>
      survey.complete === true &&
      survey.crossingInternalIds.includes(crossing.internalId),
  );
}

function increment(
  counts: Record<PredictionExclusionReason, number>,
  reasons: Set<PredictionExclusionReason>,
) {
  for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
}

export function auditVerifiedBundle(
  bundle: VerifiedBundle,
  scopes: PredictionScope[] = [],
  nowMs = Date.now(),
): SignalAuditReport {
  const excludedReasons = Object.create(null) as Record<
    PredictionExclusionReason,
    number
  >;
  let directionMapped = 0;
  let epochKnown = 0;
  let widthKnown = 0;
  let surveyCovered = 0;
  let predictionEligible = 0;
  let predictionExcluded = 0;
  const verifiedPlans = bundle.plans.filter(
    (plan) => plan.stage === "verified" && !plan.synthetic,
  );

  for (const crossing of bundle.crossings) {
    const reasons = new Set<PredictionExclusionReason>();
    if (crossing.synthetic) add(reasons, "synthetic");
    if (crossing.stage !== "verified") add(reasons, "stage_unverified");
    if (!isCrossingGeometry(crossing.geometryType)) add(reasons, "missing_geometry");
    if (!crossingDirectionMapped(crossing)) add(reasons, "missing_direction");
    else directionMapped += 1;
    if (!signalGroupMapped(crossing)) add(reasons, "missing_signal_group");
    if (!(crossing.crossingLengthM > 0)) add(reasons, "missing_width");
    else widthKnown += 1;
    if (!scopeAllows(scopes, crossing)) add(reasons, "scope_inactive");
    if (!coveredBySurvey(bundle, crossing)) add(reasons, "survey_incomplete");
    else surveyCovered += 1;

    const plan = matchingPlan(verifiedPlans, crossing, nowMs);
    if (!plan) add(reasons, "missing_plan");
    else {
      const mismatch = planFitsCrossing(crossing, plan);
      if (mismatch) add(reasons, "plan_mismatch");
      if (plan.operationMode !== "fixed") add(reasons, "plan_not_fixed");
      if (!Number.isFinite(plan.epochMs)) add(reasons, "missing_epoch");
      else epochKnown += 1;
      if (!appliedPlanIsFresh(plan.currentPlanConfirmedAt, nowMs))
        add(reasons, "stale_plan");
    }

    if (reasons.size) {
      predictionExcluded += 1;
      increment(excludedReasons, reasons);
    } else predictionEligible += 1;
  }

  return {
    crossingsTotal: bundle.crossings.length,
    crossingsVerified: bundle.crossings.filter((c) => c.stage === "verified" && !c.synthetic).length,
    plansTotal: bundle.plans.length,
    plansVerified: verifiedPlans.length,
    directionMapped,
    epochKnown,
    widthKnown,
    surveyCovered,
    predictionEligible,
    predictionExcluded,
    excludedReasons,
    predictionReady: false,
    relationship: RELATIONSHIP,
  };
}
