import {
  bearingDeg,
  meters,
  pathLength,
  type Coord,
  type Route,
} from "./core.ts";
import type { MapPoint } from "./RealMap.helpers.ts";

export type DemoSignalPrediction = {
  signalId: string;
  atM: number;
  etaSec: number;
  waitSec: number;
  predictedState: "red" | "green";
  predictionMode: "demo";
  greenStartSec: number;
  greenEndSec: number;
};

export const SIGNAL_DEMO_ROUTE: Route = {
  id: "gangnam-signal-demo",
  name: "강남역 신호 타이밍 시연",
  coordinates: [
    [127.02875795264038, 37.498076243713754],
    [127.02945, 37.49819],
    [127.03022, 37.49835],
    [127.03102, 37.49872],
    [127.03124, 37.49935],
    [127.03102, 37.50018],
    [127.03072, 37.50104],
    [127.03028620611877, 37.50199523828162],
  ],
  distanceM: 626,
  sharpTurns: 2,
  zigzags: 0,
  option: "demo",
  instructions: [
    { coord: [127.03102, 37.49872], text: "약 40m 앞에서 오른쪽" },
    { coord: [127.03072, 37.50104], text: "국기원 방면으로 직진" },
  ],
  nearbyPois: [],
};

export const SIGNAL_DEMO_SIGNALS = [
  { id: "demo-01", label: "신호 1", atM: 95, cycleSec: 20, greenStartSec: 0, greenEndSec: 14 },
  { id: "demo-02", label: "신호 2", atM: 215, cycleSec: 20, greenStartSec: 0, greenEndSec: 14 },
  { id: "demo-03", label: "신호 3", atM: 360, cycleSec: 20, greenStartSec: 0, greenEndSec: 14 },
  { id: "demo-04", label: "신호 4", atM: 505, cycleSec: 20, greenStartSec: 0, greenEndSec: 14 },
] as const;
export const SIGNAL_DEMO_PACE_SEC_PER_KM = 360;
export const SIGNAL_DEMO_GREEN_HOLD_SEC = 2;

export function signalDemoEnabled(search: string) {
  return (
    import.meta.env.VITE_SIGNAL_DEMO === "true" ||
    new URLSearchParams(search).get("demo") === "signal"
  );
}

export function coordAtDistance(route: Route, atM: number): Coord {
  let traveled = 0;
  for (let i = 1; i < route.coordinates.length; i += 1) {
    const a = route.coordinates[i - 1],
      b = route.coordinates[i],
      d = meters(a, b);
    if (traveled + d >= atM) {
      const t = d <= 0 ? 0 : (atM - traveled) / d;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    traveled += d;
  }
  return route.coordinates.at(-1)!;
}

export function demoRunnerState(route: Route, progressM: number) {
  const coord = coordAtDistance(route, progressM);
  const ahead = coordAtDistance(route, Math.min(pathLength(route.coordinates), progressM + 8));
  return { coord, heading: bearingDeg(coord, ahead) };
}

export function demoSignalPredictions(
  progressM: number,
  paceSecPerKm = SIGNAL_DEMO_PACE_SEC_PER_KM,
): DemoSignalPrediction[] {
  return SIGNAL_DEMO_SIGNALS.map((signal) => {
    const remainM = Math.max(0, signal.atM - progressM);
    const etaSec = (remainM / 1000) * paceSecPerKm;
    const phase = ((etaSec % signal.cycleSec) + signal.cycleSec) % signal.cycleSec;
    const inGreen = phase >= signal.greenStartSec && phase <= signal.greenEndSec;
    const waitSec = inGreen
      ? 0
      : phase < signal.greenStartSec
        ? signal.greenStartSec - phase
        : signal.cycleSec - phase + signal.greenStartSec;
    return {
      signalId: signal.id,
      atM: signal.atM,
      etaSec,
      waitSec,
      predictedState: inGreen ? "green" : "red",
      predictionMode: "demo",
      greenStartSec: signal.greenStartSec,
      greenEndSec: signal.greenEndSec,
    };
  });
}

export function demoSignalPoints(progressM: number, predictions: DemoSignalPrediction[]): MapPoint[] {
  const next = predictions.find((p) => p.atM > progressM + 5);
  return predictions.map((p) => {
    const display = demoSignalDisplayState(p, progressM, next?.signalId ?? null);
    const state =
      display === "past"
        ? "demo-signal-past"
        : display === "next-green"
          ? "demo-signal-green"
          : display === "next-red"
            ? "demo-signal-next"
            : "demo-signal-red";
    return {
      coord: coordAtDistance(SIGNAL_DEMO_ROUTE, p.atM),
      name: `${p.signalId} · 예상 대기 ${Math.round(p.waitSec)}초`,
      kind: state,
    };
  });
}

export function demoSignalDisplayState(
  signal: DemoSignalPrediction,
  progressM: number,
  nextSignalId: string | null,
): "past" | "next-red" | "next-green" | "red" {
  if (signal.atM < progressM - 8) return "past";
  if (signal.signalId !== nextSignalId) return "red";
  return signal.predictedState === "green" ? "next-green" : "next-red";
}
