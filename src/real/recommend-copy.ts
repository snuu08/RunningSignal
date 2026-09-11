import type { AvoidanceCheck } from "./core.ts";
import type { RecommendationReason, SignalCoverage } from "./api-contract.ts";

export function coverageCopy(coverage: SignalCoverage): string {
  if (coverage === "complete")
    return "이 후보는 조사된 구간 기준으로 신호 대기를 모두 반영했어요.";
  if (coverage === "partial")
    return "일부 횡단만 확인됐어요. 전체 대기시간으로 보지 마세요.";
  return "이 경로의 신호 정보는 아직 확인되지 않았어요. 신호등이 없다고 단정하지 않습니다.";
}

export function avoidanceCopy(avoidance: AvoidanceCheck): string[] {
  const out: string[] = [];
  if (avoidance.stairs === "tmap-option-30")
    out.push("계단은 보행 경로 옵션으로 제외를 요청했어요.");
  if (avoidance.overpass === "excluded")
    out.push("안내 문구에 육교·고가가 있는 후보는 걸렀어요.");
  if (avoidance.overpass === "unconfirmed")
    out.push("육교 여부는 안내 문구로만 확인해요. 지금은 회피 확인 불가입니다.");
  if (avoidance.alley === "preferred-wide")
    out.push("큰길 우선 후보를 먼저 썼어요.");
  if (avoidance.alley === "unconfirmed")
    out.push("골목 여부는 안내 문구로만 확인해요. 지금은 회피 확인 불가입니다.");
  return out;
}

export function recommendSentences(input: {
  reason: RecommendationReason;
  coverage: SignalCoverage;
  liveSignals: boolean;
  extraM: number;
  sharpTurns: number;
}): string[] {
  const lines: string[] = [];
  if (input.reason === "signal-compare" && input.liveSignals) {
    lines.push(
      "확인된 신호 대기를 비교해 직진 후보와 우회 후보를 가렸어요. 15초 이상이면 우회를 검토하되, 돌아간 거리와 방향 전환이 더 크면 직진을 유지합니다.",
    );
  } else {
    lines.push(
      `실제 보행 경로 거리와 방향 전환을 비교한 기본 추천입니다. 우회 약 ${Math.round(input.extraM)}m · 급회전 ${input.sharpTurns}회.`,
    );
  }
  lines.push(coverageCopy(input.coverage));
  return lines.slice(0, 2);
}
