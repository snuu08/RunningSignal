import { validPace } from "./core.ts";
import type { RunRecord } from "./storage.ts";

/** Signal wait UI stays unpublished until mapping/plans are verified and LIVE_SIGNAL_UI is flipped. */
export const LIVE_SIGNAL_UI = false;

export function showSignalWait(predictionReady: boolean): boolean {
  return LIVE_SIGNAL_UI && predictionReady;
}

/** Trial off-route thresholds. Not a surveyed product value. */
export const TRIAL_OFF_ROUTE = {
  distanceM: 45,
  consecutiveFixes: 4,
  accuracyMaxM: 25,
};

export function realPage(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/" || clean === "/real") return "home";
  if (clean.startsWith("/real/")) return clean.slice("/real/".length) || "home";
  return clean.replace(/^\//, "") || "home";
}

export function sustainedOffRoute(
  samples: { offRouteM: number; accuracy: number }[],
  cfg = TRIAL_OFF_ROUTE,
): boolean {
  if (samples.length < cfg.consecutiveFixes) return false;
  return samples.slice(-cfg.consecutiveFixes).every(
    (s) =>
      Number.isFinite(s.offRouteM) &&
      Number.isFinite(s.accuracy) &&
      s.accuracy <= cfg.accuracyMaxM &&
      s.offRouteM > cfg.distanceM,
  );
}

export type PaceSuggestion = {
  paceSec: number | null;
  used: number;
  skipped: number;
  reason: string;
};

/**
 * Usual-pace suggestion from saved runs: total moving time / total distance.
 * Manual pause is excluded (activeSec). Signal wait is not split out.
 * Zero-distance and large GPS-gap sessions are skipped, not treated as 0 pace.
 */
export function suggestedUsualFromRecords(
  records: Pick<RunRecord, "track" | "activeSec">[],
): PaceSuggestion {
  let used = 0;
  let skipped = 0;
  let timeSec = 0;
  let distanceM = 0;
  for (const r of records) {
    const distance = r.track.distanceM;
    const gap = r.track.gapSec;
    if (
      !(distance >= 100) ||
      !(r.activeSec > 0) ||
      gap > 30 ||
      !Number.isFinite(distance) ||
      !Number.isFinite(r.activeSec)
    ) {
      skipped += 1;
      continue;
    }
    used += 1;
    timeSec += r.activeSec;
    distanceM += distance;
  }
  if (!used || !(distanceM > 0))
    return {
      paceSec: null,
      used,
      skipped,
      reason:
        skipped > 0
          ? "거리 부족·수신 공백이 큰 기록은 평균에서 뺐어요."
          : "평균에 쓸 기록이 아직 없어요.",
    };
  const paceSec = Math.round(timeSec / (distanceM / 1000));
  if (!validPace(paceSec))
    return {
      paceSec: null,
      used,
      skipped,
      reason: "계산된 페이스가 허용 범위를 벗어났어요.",
    };
  return {
    paceSec,
    used,
    skipped,
    reason: `운동시간÷기록거리 · ${used}개 기록${skipped ? ` · ${skipped}개 제외` : ""} · 신호 대기는 분리하지 않음`,
  };
}
