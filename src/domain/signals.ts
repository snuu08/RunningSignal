import { CROSSING_BUFFER_SEC } from "../config/app.ts";
import type {
  CrossingOnPath,
  CrossingPlan,
  DirectedEdge,
  PathCandidate,
  PathEvaluation,
  SignalLookup,
  TimeEstimate,
  WaitEstimate,
} from "./models.ts";
import { addEstimates, travelSeconds } from "./pace.ts";
import { evaluateTurns } from "./turns.ts";

export function positiveModulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function isPlanValid(plan: CrossingPlan, atSec: number): boolean {
  const { validFromSec, validToSec } = plan.planValidity;
  if (validFromSec !== null && atSec < validFromSec) return false;
  if (validToSec !== null && atSec > validToSec) return false;
  return true;
}

export function remainingGreenEntry(
  cyclePos: number,
  plan: CrossingPlan,
): number {
  const { startSec, endSec } = plan.greenEntryWindow;
  if (cyclePos >= startSec && cyclePos < endSec) return endSec - cyclePos;
  return 0;
}

export function inClearance(cyclePos: number, plan: CrossingPlan): boolean {
  const { startSec, endSec } = plan.clearanceWindow;
  return cyclePos >= startSec && cyclePos < endSec;
}

export function secondsUntilNextGreen(cyclePos: number, plan: CrossingPlan): number {
  const start = plan.greenEntryWindow.startSec;
  if (cyclePos <= start) return start - cyclePos;
  return plan.cycleSeconds - cyclePos + start;
}

export type CrossingWaitResult =
  | { kind: "exact"; seconds: number }
  | { kind: "unknown"; reason: string };

export function waitAtCrossing(
  arrivalSec: number,
  plan: CrossingPlan,
  crossingWidthM: number,
  paceSecondsPerKm: number,
  bufferSec = CROSSING_BUFFER_SEC,
): CrossingWaitResult {
  if (plan.freshness === "unknown" || plan.capability === "location-only") {
    return { kind: "unknown", reason: "신호 계획이 없습니다." };
  }
  if (plan.capability === "current-state") {
    return {
      kind: "unknown",
      reason: "현재 상태만 있어 미래 대기를 확정할 수 없습니다.",
    };
  }
  if (!isPlanValid(plan, arrivalSec)) {
    return { kind: "unknown", reason: "운영계획이 유효 시간을 벗어났습니다." };
  }

  const crossingSec = travelSeconds(crossingWidthM, paceSecondsPerKm);
  const needed = crossingSec + bufferSec;
  const cyclePos = positiveModulo(arrivalSec - plan.referenceTimeSec, plan.cycleSeconds);
  const remain = remainingGreenEntry(cyclePos, plan);

  if (remain > 0 && remain >= needed) {
    return { kind: "exact", seconds: 0 };
  }

  if (inClearance(cyclePos, plan)) {
    return { kind: "exact", seconds: secondsUntilNextGreen(cyclePos, plan) };
  }

  return { kind: "exact", seconds: secondsUntilNextGreen(cyclePos, plan) };
}

function walkScore(edges: DirectedEdge[]): number {
  if (edges.some((edge) => !edge.walkable)) return 0;
  const length = edges.reduce((sum, edge) => sum + edge.lengthM, 0) || 1;
  let stairsM = 0;
  let overpassM = 0;
  for (const edge of edges) {
    if (edge.isStairs || edge.walkKind === "stairs") stairsM += edge.lengthM;
    if (edge.isOverpass || edge.walkKind === "overpass") overpassM += edge.lengthM;
  }
  let score = 1 - (stairsM / length) * 0.75 - (overpassM / length) * 0.65;
  const kinds = new Set(edges.map((edge) => edge.walkKind));
  if (kinds.has("alley")) score *= 0.9;
  if (kinds.has("park_path")) score *= 1.04;
  return Math.max(0.05, score);
}

function viaLabel(edges: DirectedEdge[]): string {
  const kinds = new Set(edges.map((e) => e.walkKind));
  if (kinds.has("park_path")) return "공원길";
  if (kinds.has("alley")) return "골목길";
  if (kinds.has("bridge")) return "다리 건너 길";
  return "큰길";
}

export function evaluatePath(
  candidate: PathCandidate,
  paceSecondsPerKm: number | null,
  startSec: number,
  signals: SignalLookup,
): PathEvaluation {
  const turns = evaluateTurns(candidate.geometry);
  const crossings: CrossingOnPath[] = [];
  const paceAvailable = paceSecondsPerKm !== null && paceSecondsPerKm > 0;
  let cursor: TimeEstimate = paceAvailable
    ? { kind: "exact", seconds: startSec }
    : { kind: "unknown" };
  let waitTotal: TimeEstimate = paceAvailable ? { kind: "exact", seconds: 0 } : { kind: "unknown" };
  let stopCount = 0;
  let signalCrossingCount = 0;
  let knownCrossingCount = 0;
  let unknownCrossingCount = 0;
  let maxExactWaitSec: number | null = null;
  let travelOnly = 0;

  for (const edge of candidate.directedEdges) {
    if (paceAvailable) {
      const move = travelSeconds(edge.lengthM, paceSecondsPerKm);
      travelOnly += move;
      cursor = addEstimates(cursor, { kind: "exact", seconds: move });
    }

    const plan = signals.get(edge.directedEdgeId);
    if (plan === null) continue;
    signalCrossingCount += 1;

    if (!paceAvailable) {
      unknownCrossingCount += 1;
      crossings.push({
        directedEdgeId: edge.directedEdgeId,
        arrival: { kind: "unknown" },
        wait: {
          kind: "unknown",
          crossingId: plan === "unknown" ? undefined : plan.crossingId,
          reason: "페이스가 없어 도착 시각을 확정하지 않습니다.",
        },
        departure: { kind: "unknown" },
      });
      continue;
    }

    if (plan === "unknown" || cursor.kind !== "exact") {
      unknownCrossingCount += 1;
      crossings.push({
        directedEdgeId: edge.directedEdgeId,
        arrival: cursor,
        wait: {
          kind: "unknown",
          reason: "이전 구간이 불확실하거나 신호 데이터가 없습니다.",
        },
        departure: { kind: "unknown" },
      });
      cursor = { kind: "unknown" };
      waitTotal = { kind: "unknown" };
      continue;
    }

    const wait = waitAtCrossing(cursor.seconds, plan, plan.crossingWidthM, paceSecondsPerKm);
    if (wait.kind === "unknown") {
      unknownCrossingCount += 1;
      crossings.push({
        directedEdgeId: edge.directedEdgeId,
        arrival: cursor,
        wait: { kind: "unknown", crossingId: plan.crossingId, reason: wait.reason },
        departure: { kind: "unknown" },
      });
      cursor = { kind: "unknown" };
      waitTotal = { kind: "unknown" };
      continue;
    }

    knownCrossingCount += 1;
    if (wait.seconds > 0) stopCount += 1;
    if (maxExactWaitSec === null || wait.seconds > maxExactWaitSec) {
      maxExactWaitSec = wait.seconds;
    }
    const waitEst: WaitEstimate = { kind: "exact", seconds: wait.seconds, crossing: plan };
    const departure = addEstimates(cursor, { kind: "exact", seconds: wait.seconds });
    crossings.push({
      directedEdgeId: edge.directedEdgeId,
      arrival: cursor,
      wait: waitEst,
      departure,
    });
    cursor = departure;
    waitTotal = addEstimates(waitTotal, { kind: "exact", seconds: wait.seconds });
  }

  const travelSec: TimeEstimate = paceAvailable
    ? { kind: "exact", seconds: travelOnly }
    : { kind: "unknown" };
  const totalSec: TimeEstimate = paceAvailable
    ? addEstimates(travelSec, waitTotal)
    : { kind: "unknown" };
  const complete =
    paceAvailable &&
    unknownCrossingCount === 0 &&
    waitTotal.kind === "exact" &&
    totalSec.kind === "exact";

  return {
    candidate: { ...candidate, viaLabel: candidate.viaLabel || viaLabel(candidate.directedEdges) },
    travelSec,
    waitSec: waitTotal,
    totalSec,
    stopCount,
    signalCrossingCount,
    knownCrossingCount,
    unknownCrossingCount,
    crossings,
    turnScore: turns.turnScore,
    walkScore: walkScore(candidate.directedEdges),
    sharpTurns: turns.sharpTurns,
    zigzagPairs: turns.zigzagPairs,
    maxExactWaitSec,
    complete,
    paceAvailable,
    signalComparisonReady: complete,
  };
}

export function needsDetourSearch(waitSec: number, threshold = 15): boolean {
  return waitSec >= threshold;
}

export function remainingToNextCrossing(
  evaluation: PathEvaluation,
  progressM: number,
): number | null {
  let acc = 0;
  for (const edge of evaluation.candidate.directedEdges) {
    acc += edge.lengthM;
    const hit = evaluation.crossings.find((c) => c.directedEdgeId === edge.directedEdgeId);
    if (!hit) continue;
    if (progressM < acc - 0.5) return Math.max(0, acc - progressM);
  }
  return null;
}

export function crossingAtProgress(
  evaluation: PathEvaluation,
  progressM: number,
): CrossingOnPath | null {
  let acc = 0;
  for (const edge of evaluation.candidate.directedEdges) {
    acc += edge.lengthM;
    const hit = evaluation.crossings.find((c) => c.directedEdgeId === edge.directedEdgeId);
    if (!hit) continue;
    if (progressM + 0.8 >= acc && progressM <= acc + 0.8) return hit;
  }
  return null;
}
