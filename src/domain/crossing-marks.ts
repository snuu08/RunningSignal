import type { CrossingPlan, PathEvaluation } from "./models.ts";
import { remainingToNextCrossing } from "./signals.ts";

export type CrossingMarkInfo = "predictable" | "unknown" | "location-only";

export type CrossingMark = {
  plan: CrossingPlan;
  onRoute: boolean;
  info: CrossingMarkInfo;
  waitSec: number | null;
  next: boolean;
};

function infoFor(plan: CrossingPlan, evaluation: PathEvaluation | null): CrossingMarkInfo {
  if (plan.capability === "location-only" || plan.freshness === "unknown") return "location-only";
  const hit = evaluation?.crossings.find((item) => item.directedEdgeId === plan.directedEdgeId);
  if (!hit || hit.wait.kind === "unknown") return "unknown";
  if (hit.wait.kind === "exact") return "predictable";
  return "unknown";
}

export function marksForEvaluation(
  evaluation: PathEvaluation | null,
  allPlans: CrossingPlan[],
  progressM = 0,
): CrossingMark[] {
  const onRouteIds = new Set(evaluation?.crossings.map((item) => item.directedEdgeId) ?? []);
  const nextRemain = evaluation ? remainingToNextCrossing(evaluation, progressM) : null;
  let acc = 0;
  let nextId: string | null = null;
  if (evaluation && nextRemain !== null) {
    for (const edge of evaluation.candidate.directedEdges) {
      acc += edge.lengthM;
      const hit = evaluation.crossings.find((item) => item.directedEdgeId === edge.directedEdgeId);
      if (!hit) continue;
      if (progressM < acc - 0.5) {
        nextId = edge.directedEdgeId;
        break;
      }
    }
  }

  return allPlans
    .filter((plan) => plan.point)
    .map((plan) => {
      const onRoute = onRouteIds.has(plan.directedEdgeId);
      const hit = evaluation?.crossings.find((item) => item.directedEdgeId === plan.directedEdgeId);
      const waitSec = hit?.wait.kind === "exact" ? hit.wait.seconds : null;
      return {
        plan,
        onRoute,
        info: infoFor(plan, evaluation),
        waitSec,
        next: onRoute && plan.directedEdgeId === nextId,
      };
    });
}

export function filterCrossingMarks(
  marks: CrossingMark[],
  options: {
    showRouteSignals: boolean;
    showNearbySignals: boolean;
    selectedCrossingId?: string | null;
    viewSpanM?: number;
  },
): CrossingMark[] {
  const seen = new Set<string>();
  const selected = options.selectedCrossingId ?? null;
  const keep = marks.filter((mark) => {
    if (seen.has(mark.plan.crossingId)) return false;
    seen.add(mark.plan.crossingId);
    if (selected && mark.plan.crossingId === selected) return true;
    if (mark.onRoute) return options.showRouteSignals;
    return options.showNearbySignals;
  });

  const span = options.viewSpanM ?? 0;
  if (!options.showNearbySignals || span < 700) return keep;
  const cell = Math.max(70, span / 10);
  const used = new Set<string>();
  return keep.filter((mark) => {
    if (mark.onRoute || mark.plan.crossingId === selected) return true;
    const key = `${Math.round(mark.plan.point.x / cell)}:${Math.round(mark.plan.point.y / cell)}`;
    if (used.has(key)) return false;
    used.add(key);
    return true;
  });
}

export function remainingPathDistanceToCrossing(
  evaluation: PathEvaluation,
  directedEdgeId: string,
  progressM = 0,
): number | null {
  let acc = 0;
  for (const edge of evaluation.candidate.directedEdges) {
    acc += edge.lengthM;
    if (edge.directedEdgeId === directedEdgeId) {
      return Math.max(0, acc - progressM);
    }
  }
  return null;
}
