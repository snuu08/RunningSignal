import {
  INITIAL_DETOUR_RATIO,
  WAIT_DETOUR_THRESHOLD_SEC,
} from "../config/app.ts";
import type {
  PathEvaluation,
  Recommendation,
  RouteRequest,
  SignalLookup,
  WalkingNetwork,
} from "./models.ts";
import { enumeratePaths } from "./pathfinding.ts";
import { formatDuration } from "./pace.ts";
import { evaluatePath, needsDetourSearch } from "./signals.ts";

export type RoutingPolicyConfig = {
  detourRatio: number;
  waitThresholdSec: number;
};

export const defaultRoutingPolicy: RoutingPolicyConfig = {
  detourRatio: INITIAL_DETOUR_RATIO,
  waitThresholdSec: WAIT_DETOUR_THRESHOLD_SEC,
};

function continuityScore(ev: PathEvaluation): number {
  return ev.walkScore * 0.45 + ev.turnScore * 0.4 + 1 / (1 + ev.candidate.lengthM / 800) * 0.15;
}

function rankBaseline(a: PathEvaluation, b: PathEvaluation): number {
  const walkableA = a.walkScore > 0 ? 1 : 0;
  const walkableB = b.walkScore > 0 ? 1 : 0;
  if (walkableA !== walkableB) return walkableB - walkableA;
  const stairsA = a.candidate.directedEdges.some((e) => e.isStairs || e.isOverpass);
  const stairsB = b.candidate.directedEdges.some((e) => e.isStairs || e.isOverpass);
  if (stairsA !== stairsB) return Number(stairsA) - Number(stairsB);
  const score = continuityScore(b) - continuityScore(a);
  if (Math.abs(score) > 1e-6) return score;
  return a.candidate.lengthM - b.candidate.lengthM;
}

function buildReason(baseline: PathEvaluation, chosen: PathEvaluation): string {
  if (chosen.candidate.fingerprint === baseline.candidate.fingerprint) {
    if (baseline.maxExactWaitSec !== null && baseline.maxExactWaitSec >= WAIT_DETOUR_THRESHOLD_SEC) {
      return `기준 경로에서 ${Math.round(baseline.maxExactWaitSec)}초 대기가 예상되지만, 직선성과 보행 적합성을 만족하는 대체 경로가 없습니다.`;
    }
    return "보행 가능한 연결망에서 방향 전환이 적은 길을 골랐어요. 입력한 페이스는 그대로 유지합니다.";
  }
  const wait = baseline.maxExactWaitSec ?? 0;
  const extra = Math.round(chosen.candidate.lengthM - baseline.candidate.lengthM);
  const savedWait =
    baseline.waitSec.kind === "exact" && chosen.waitSec.kind === "exact"
      ? Math.round(baseline.waitSec.seconds - chosen.waitSec.seconds)
      : null;
  const extraText = extra >= 0 ? `${extra}m 더 달립니다` : `${Math.abs(extra)}m 짧습니다`;
  const waitText = savedWait !== null ? ` 대기는 약 ${savedWait}초 줄어듭니다.` : "";
  return `${Math.round(wait)}초 대기가 예상되는 교차로 대신 ${chosen.candidate.viaLabel}을 이용해요. 기준 경로보다 ${extraText}.${waitText}`;
}

export function planRoutes(
  request: RouteRequest,
  network: WalkingNetwork,
  signals: SignalLookup,
  config: RoutingPolicyConfig = defaultRoutingPolicy,
): Recommendation | { error: string } {
  if (request.origin.nodeId === request.destination.nodeId) {
    return { error: "출발과 도착이 같습니다. 다른 지점을 골라 주세요." };
  }

  const waypointIds = request.waypoints.map((w) => w.nodeId);
  const raw = enumeratePaths(
    network,
    request.origin.nodeId,
    request.destination.nodeId,
    waypointIds,
    request.seed,
  );

  const evaluated = raw
    .filter((c) => c.directedEdges.length > 0)
    .map((c) => evaluatePath(c, request.paceSecondsPerKm, request.departure.atSec, signals))
    .filter((e) => e.walkScore > 0);

  if (evaluated.length === 0) {
    return { error: "연결된 보행 경로를 찾지 못했습니다. 다른 데모 장소를 골라 보세요." };
  }

  const ordered = [...evaluated].sort(rankBaseline);
  const baseline = ordered[0];
  const alts = ordered.filter((e) => e.candidate.fingerprint !== baseline.candidate.fingerprint);

  let chosen = baseline;
  const longWait =
    baseline.maxExactWaitSec !== null &&
    needsDetourSearch(baseline.maxExactWaitSec, config.waitThresholdSec);

  if (longWait) {
    const maxLen = baseline.candidate.lengthM * (1 + config.detourRatio);
    const viable = alts.filter((e) => e.candidate.lengthM <= maxLen + 1e-6);
    viable.sort((a, b) => {
      const aWait = a.maxExactWaitSec ?? Number.POSITIVE_INFINITY;
      const bWait = b.maxExactWaitSec ?? Number.POSITIVE_INFINITY;
      if (aWait !== bWait) return aWait - bWait;
      return continuityScore(b) - continuityScore(a);
    });
    const better = viable.find((e) => {
      const wait = e.maxExactWaitSec;
      return wait !== null && wait < (baseline.maxExactWaitSec ?? Infinity);
    });
    if (better) chosen = better;
  }

  const alternatives = ordered.filter((e) => e.candidate.fingerprint !== chosen.candidate.fingerprint);

  return {
    chosen,
    baseline,
    alternatives,
    reason: buildReason(baseline, chosen),
    detourRatioUsed: config.detourRatio,
    waitThresholdSec: config.waitThresholdSec,
  };
}

export function nextAlternative(
  current: Recommendation,
  seenIds: string[],
): PathEvaluation | null {
  return (
    current.alternatives.find((a) => !seenIds.includes(a.candidate.id)) ?? null
  );
}

export function describeTimeline(evaluation: PathEvaluation): string {
  if (evaluation.complete && evaluation.totalSec.kind === "exact") {
    return `예상 총시간 ${formatDuration(evaluation.totalSec.seconds)}`;
  }
  return "확인된 구간 기준이며, 일부 신호는 예측할 수 없습니다.";
}
