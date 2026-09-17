import { forecast, validPace, type Forecast } from "../../core.ts";

export type LiveSignalGuidance = {
  current: string;
  arrival: string;
  guidance: string;
  waitSec: number | null;
  remainM: number | null;
  etaSec: number | null;
};

const UNKNOWN_LIVE_SIGNAL: LiveSignalGuidance = {
  current: "현재 보행신호: 실시간 진단 화면에서만 확인",
  arrival: "예상 도착 시 신호: 미확인",
  guidance: "실제 신호를 직접 확인한 뒤 건너세요.",
  waitSec: null,
  remainM: null,
  etaSec: null,
};

export function liveSignalGuidance({
  routeForecast,
  traveledM,
  livePace,
  nowMs,
}: {
  routeForecast: Forecast | null;
  traveledM: number | null;
  livePace: number;
  nowMs: number | null;
}): LiveSignalGuidance | null {
  if (!routeForecast || traveledM === null || !validPace(livePace) || nowMs === null)
    return null;
  const next = routeForecast.crossings.find(
    (c) => typeof c.atM === "number" && c.atM > traveledM + 5,
  );
  if (!next || typeof next.atM !== "number") return UNKNOWN_LIVE_SIGNAL;

  const remainM = Math.max(0, next.atM - traveledM);
  const etaSec = (remainM / 1000) * livePace;
  if (!next.plan || !(next.widthM && next.widthM > 0))
    return { ...UNKNOWN_LIVE_SIGNAL, remainM, etaSec };

  const projected = forecast(
    remainM,
    livePace,
    nowMs,
    [
      {
        id: next.id,
        name: next.id,
        atM: remainM,
        widthM: next.widthM,
        plan: next.plan,
      },
    ],
    true,
    nowMs,
  );
  const waitSec = projected.crossings[0]?.waitSec ?? null;
  const nearCrossing = remainM < 30;
  return {
    current: UNKNOWN_LIVE_SIGNAL.current,
    arrival:
      waitSec === null
        ? UNKNOWN_LIVE_SIGNAL.arrival
        : `예상 도착 시 신호: 대기 약 ${Math.round(waitSec)}초`,
    guidance:
      waitSec === null
        ? UNKNOWN_LIVE_SIGNAL.guidance
        : nearCrossing
          ? "횡단보도 앞입니다. 속도보다 안전 확인이 먼저입니다."
          : waitSec >= 5 && waitSec <= 45
            ? "현재 속도보다 약간 천천히 가면 다음 녹색 구간에 도착할 가능성이 있습니다."
            : "현재 페이스를 유지해도 됩니다. 실제 신호를 직접 확인한 뒤 건너세요.",
    waitSec,
    remainM,
    etaSec,
  };
}
