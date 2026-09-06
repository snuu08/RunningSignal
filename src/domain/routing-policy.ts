import {
  BALANCED_STOP_VALUE_M,
  BALANCED_WAIT_VALUE_M_PER_SEC,
  INITIAL_DETOUR_MAX_M,
  INITIAL_DETOUR_RATIO,
  WAIT_DIFF_NEGLIGIBLE_SEC,
  WAIT_DETOUR_THRESHOLD_SEC,
} from "../config/app.ts";
import type {
  PathEvaluation,
  RecommendStyle,
  Recommendation,
  RouteRequest,
  SignalLookup,
  WalkingNetwork,
} from "./models.ts";
import { enumeratePaths } from "./pathfinding.ts";
import { formatDuration, travelSeconds } from "./pace.ts";
import { evaluatePath, needsDetourSearch } from "./signals.ts";

export type RoutingPolicyConfig = {
  detourRatio: number;
  detourMaxM: number;
  waitThresholdSec: number;
  waitDiffNegligibleSec: number;
  recommendStyle: RecommendStyle;
  avoidStairs: boolean;
  avoidOverpass: boolean;
  balancedStopValueM: number;
  balancedWaitValueMPerSec: number;
};

export const defaultRoutingPolicy: RoutingPolicyConfig = {
  detourRatio: INITIAL_DETOUR_RATIO,
  detourMaxM: INITIAL_DETOUR_MAX_M,
  waitThresholdSec: WAIT_DETOUR_THRESHOLD_SEC,
  waitDiffNegligibleSec: WAIT_DIFF_NEGLIGIBLE_SEC,
  recommendStyle: "balanced",
  avoidStairs: true,
  avoidOverpass: true,
  balancedStopValueM: BALANCED_STOP_VALUE_M,
  balancedWaitValueMPerSec: BALANCED_WAIT_VALUE_M_PER_SEC,
};

export function allowedExtraMeters(
  baselineM: number,
  ratio: number,
  maxM: number,
): number {
  return Math.min(Math.max(0, baselineM) * ratio, maxM);
}

function continuityScore(ev: PathEvaluation): number {
  return ev.walkScore * 0.45 + ev.turnScore * 0.4 + (1 / (1 + ev.candidate.lengthM / 800)) * 0.15;
}

export function pathHasStairs(ev: PathEvaluation): boolean {
  return ev.candidate.directedEdges.some((edge) => edge.isStairs || edge.walkKind === "stairs");
}

export function pathHasOverpass(ev: PathEvaluation): boolean {
  return ev.candidate.directedEdges.some((edge) => edge.isOverpass || edge.walkKind === "overpass");
}

function hasHardObstacle(ev: PathEvaluation): boolean {
  return pathHasStairs(ev) || pathHasOverpass(ev);
}

export function describeIncludedObstacles(ev: PathEvaluation): string | null {
  const stairs = pathHasStairs(ev);
  const overpass = pathHasOverpass(ev);
  if (stairs && overpass) return "계단 포함 · 육교 포함";
  if (stairs) return "계단 포함";
  if (overpass) return "육교 포함";
  return null;
}

function obstaclePenalty(ev: PathEvaluation, config: RoutingPolicyConfig): number {
  let penalty = 0;
  if (config.avoidStairs && pathHasStairs(ev)) penalty += 1;
  if (config.avoidOverpass && pathHasOverpass(ev)) penalty += 1;
  return penalty;
}

function rankBaseline(a: PathEvaluation, b: PathEvaluation): number {
  const walkableA = a.walkScore > 0 ? 1 : 0;
  const walkableB = b.walkScore > 0 ? 1 : 0;
  if (walkableA !== walkableB) return walkableB - walkableA;
  const stairsA = hasHardObstacle(a);
  const stairsB = hasHardObstacle(b);
  if (stairsA !== stairsB) return Number(stairsA) - Number(stairsB);
  const score = continuityScore(b) - continuityScore(a);
  if (Math.abs(score) > 1e-6) return score;
  return a.candidate.lengthM - b.candidate.lengthM;
}

export function withinDetourLimits(
  baselineM: number,
  candidateM: number,
  config: RoutingPolicyConfig = defaultRoutingPolicy,
): boolean {
  const extra = candidateM - baselineM;
  if (extra <= 0) return true;
  return extra <= allowedExtraMeters(baselineM, config.detourRatio, config.detourMaxM) + 1e-6;
}

export function runFitAcceptable(baseline: PathEvaluation, candidate: PathEvaluation): boolean {
  if (candidate.walkScore <= 0) return false;
  if (candidate.walkScore + 1e-9 < baseline.walkScore * 0.72) return false;
  if (candidate.sharpTurns > baseline.sharpTurns + 2) return false;
  return true;
}

function exactWaitSec(ev: PathEvaluation): number | null {
  return ev.waitSec.kind === "exact" ? ev.waitSec.seconds : null;
}

export function compareMinStops(
  a: PathEvaluation,
  b: PathEvaluation,
  baseline: PathEvaluation,
  config: RoutingPolicyConfig = defaultRoutingPolicy,
): number {
  if (a.stopCount !== b.stopCount) return a.stopCount - b.stopCount;
  const aWait = exactWaitSec(a) ?? Number.POSITIVE_INFINITY;
  const bWait = exactWaitSec(b) ?? Number.POSITIVE_INFINITY;
  if (Math.abs(aWait - bWait) > config.waitDiffNegligibleSec) return aWait - bWait;
  const extraA = a.candidate.lengthM - baseline.candidate.lengthM;
  const extraB = b.candidate.lengthM - baseline.candidate.lengthM;
  if (Math.abs(extraA - extraB) > 1) return extraA - extraB;
  if (a.sharpTurns !== b.sharpTurns) return a.sharpTurns - b.sharpTurns;
  return a.candidate.lengthM - b.candidate.lengthM;
}

export function waitSavedSeconds(baseline: PathEvaluation, candidate: PathEvaluation): number {
  const baseWait = exactWaitSec(baseline);
  const candWait = exactWaitSec(candidate);
  if (baseWait === null || candWait === null) return 0;
  return baseWait - candWait;
}

export function balancedTradeoffScore(
  baseline: PathEvaluation,
  candidate: PathEvaluation,
  config: RoutingPolicyConfig = defaultRoutingPolicy,
): number {
  const extra = Math.max(0, candidate.candidate.lengthM - baseline.candidate.lengthM);
  const stopDelta = baseline.stopCount - candidate.stopCount;
  const waitSaved = waitSavedSeconds(baseline, candidate);
  return (
    extra -
    stopDelta * config.balancedStopValueM -
    waitSaved * config.balancedWaitValueMPerSec
  );
}

export function compareBalanced(
  a: PathEvaluation,
  b: PathEvaluation,
  baseline: PathEvaluation,
  config: RoutingPolicyConfig = defaultRoutingPolicy,
): number {
  const scoreA = balancedTradeoffScore(baseline, a, config);
  const scoreB = balancedTradeoffScore(baseline, b, config);
  if (Math.abs(scoreA - scoreB) > 1) return scoreA - scoreB;
  if (a.stopCount !== b.stopCount) return a.stopCount - b.stopCount;
  const extraA = a.candidate.lengthM - baseline.candidate.lengthM;
  const extraB = b.candidate.lengthM - baseline.candidate.lengthM;
  if (Math.abs(extraA - extraB) > 1) return extraA - extraB;
  if (a.sharpTurns !== b.sharpTurns) return a.sharpTurns - b.sharpTurns;
  return a.candidate.lengthM - b.candidate.lengthM;
}

export function compareSignalCandidates(
  a: PathEvaluation,
  b: PathEvaluation,
  baseline: PathEvaluation,
  config: RoutingPolicyConfig = defaultRoutingPolicy,
): number {
  const obstacle = obstaclePenalty(a, config) - obstaclePenalty(b, config);
  if (obstacle !== 0) return obstacle;
  if (config.recommendStyle === "min-stops") return compareMinStops(a, b, baseline, config);
  return compareBalanced(a, b, baseline, config);
}

export function pickPreferredPath(
  baseline: PathEvaluation,
  alternatives: PathEvaluation[],
  config: RoutingPolicyConfig = defaultRoutingPolicy,
): PathEvaluation {
  if (!baseline.paceAvailable || !baseline.signalComparisonReady) return baseline;
  const viable = alternatives.filter(
    (item) =>
      item.paceAvailable &&
      item.signalComparisonReady &&
      withinDetourLimits(baseline.candidate.lengthM, item.candidate.lengthM, config) &&
      runFitAcceptable(baseline, item),
  );
  if (viable.length === 0) return baseline;
  const ranked = [baseline, ...viable].sort((a, b) =>
    compareSignalCandidates(a, b, baseline, config),
  );
  return ranked[0];
}

export function buildReason(
  baseline: PathEvaluation,
  chosen: PathEvaluation,
  paceSecondsPerKm: number | null,
): string {
  if (!baseline.paceAvailable) {
    return "페이스가 없어 기본 보행 경로만 보여 줍니다. 도착 시점 기반 신호 예측은 확정하지 않습니다.";
  }
  if (!baseline.signalComparisonReady) {
    return "신호 정보가 부족해 기본 보행 경로를 유지합니다. 정보가 없는 횡단을 대기 0초로 보지 않습니다.";
  }
  if (chosen.candidate.fingerprint === baseline.candidate.fingerprint) {
    if (baseline.maxExactWaitSec !== null && needsDetourSearch(baseline.maxExactWaitSec)) {
      return `기준 경로에서 ${Math.round(baseline.maxExactWaitSec)}초 대기가 예상되지만, 우회 제한과 달리기 적합성을 만족하는 대체 경로가 없습니다.`;
    }
    return "보행 가능한 연결망에서 방향 전환이 적은 길을 골랐어요. 입력한 페이스는 그대로 유지합니다.";
  }

  const extraM = Math.round(chosen.candidate.lengthM - baseline.candidate.lengthM);
  const stopDelta = baseline.stopCount - chosen.stopCount;
  const extraTravel =
    paceSecondsPerKm && extraM > 0 ? travelSeconds(extraM, paceSecondsPerKm) : null;
  const waitDelta =
    baseline.waitSec.kind === "exact" && chosen.waitSec.kind === "exact"
      ? chosen.waitSec.seconds - baseline.waitSec.seconds
      : null;
  const totalDelta =
    extraTravel !== null && waitDelta !== null ? extraTravel + waitDelta : null;

  const parts: string[] = [];
  if (extraM > 0 && stopDelta > 0) {
    parts.push(`${extraM}m 더 달리는 대신 예상 정지 ${stopDelta}회를 줄여요.`);
  } else if (extraM > 0) {
    parts.push(`기준 경로보다 ${extraM}m 더 달립니다.`);
  } else if (extraM < 0) {
    parts.push(`기준 경로보다 ${Math.abs(extraM)}m 짧습니다.`);
  }
  if (totalDelta !== null) {
    const rounded = Math.round(totalDelta);
    if (rounded > 0) parts.push(`총 소요시간은 약 ${rounded}초 늘어나요.`);
    else if (rounded < 0) parts.push(`총 소요시간은 약 ${Math.abs(rounded)}초 줄어들어요.`);
  }
  return parts.join(" ") || "멈춤이 적은 대체 경로를 골랐어요.";
}

export function describeCoverage(ev: PathEvaluation): string {
  if (!ev.paceAvailable) return "페이스가 없어 신호 예측을 확정하지 않습니다.";
  if (ev.signalCrossingCount === 0) return "경로상 보행신호가 없습니다.";
  if (ev.unknownCrossingCount > 0) {
    return `보행신호 ${ev.signalCrossingCount}곳 중 ${ev.knownCrossingCount}곳 예측 가능`;
  }
  const wait =
    ev.waitSec.kind === "exact" ? `총 대기 약 ${Math.round(ev.waitSec.seconds)}초` : "총 대기 예측 불가";
  return `보행신호 ${ev.signalCrossingCount}곳 · 예상 정지 ${ev.stopCount}회 · ${wait}`;
}

export function describeVersusBaseline(baseline: PathEvaluation, chosen: PathEvaluation): string | null {
  if (chosen.candidate.fingerprint === baseline.candidate.fingerprint) return null;
  const extra = Math.round(chosen.candidate.lengthM - baseline.candidate.lengthM);
  const stopDelta = baseline.stopCount - chosen.stopCount;
  const extraText = extra >= 0 ? `${extra}m 추가` : `${Math.abs(extra)}m 감소`;
  if (!chosen.signalComparisonReady || !baseline.signalComparisonReady) {
    return `기준 경로보다 ${extraText} / 전체 대기는 예측 불가`;
  }
  if (stopDelta > 0) return `기준 경로보다 ${extraText} / 예상 정지 ${stopDelta}회 감소`;
  return `기준 경로보다 ${extraText}`;
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
  const chosen = pickPreferredPath(baseline, alts, config);
  const alternatives = ordered.filter((e) => e.candidate.fingerprint !== chosen.candidate.fingerprint);

  return {
    chosen,
    baseline,
    alternatives,
    reason: buildReason(baseline, chosen, request.paceSecondsPerKm),
    detourRatioUsed: config.detourRatio,
    waitThresholdSec: config.waitThresholdSec,
  };
}

export function nextAlternative(
  current: Recommendation,
  seenIds: string[],
): PathEvaluation | null {
  return current.alternatives.find((a) => !seenIds.includes(a.candidate.id)) ?? null;
}

export function describeTimeline(evaluation: PathEvaluation): string {
  if (!evaluation.paceAvailable) return "페이스가 없어 도착 시각을 예측하지 않습니다.";
  if (evaluation.complete && evaluation.totalSec.kind === "exact") {
    return `예상 총시간 ${formatDuration(evaluation.totalSec.seconds)}`;
  }
  if (evaluation.knownCrossingCount > 0 && evaluation.unknownCrossingCount > 0) {
    return `확인된 구간에서 예상 정지 ${evaluation.stopCount}회 / 나머지 ${evaluation.unknownCrossingCount}곳 정보 없음`;
  }
  return "확인된 구간 기준이며, 일부 신호는 예측할 수 없습니다.";
}
