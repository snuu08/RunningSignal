import { DEMO_OPEN_PACE_SECONDS } from "../config/app.ts";
import type { PaceBook, PaceInput, PaceSlotId, TimeEstimate } from "./models.ts";

export const EMPTY_PACE_BOOK: PaceBook = {
  usual: null,
  fiveK: null,
  tenK: null,
  half: null,
  full: null,
};

export const PACE_SLOTS: {
  id: PaceSlotId;
  label: string;
  shortLabel: string;
  distanceKm: number | null;
}[] = [
  { id: "usual", label: "평소 러닝 페이스", shortLabel: "평소", distanceKm: null },
  { id: "fiveK", label: "5km 페이스", shortLabel: "5km", distanceKm: 5 },
  { id: "tenK", label: "10km 페이스", shortLabel: "10km", distanceKm: 10 },
  { id: "half", label: "하프마라톤 페이스", shortLabel: "하프마라톤", distanceKm: 21.0975 },
  { id: "full", label: "풀마라톤 페이스", shortLabel: "풀마라톤", distanceKm: 42.195 },
];

export function emptyPaceBook(): PaceBook {
  return { ...EMPTY_PACE_BOOK };
}

export function normalizePaceBook(raw?: Partial<PaceBook> | null): PaceBook {
  return {
    usual: asStoredPace(raw?.usual),
    fiveK: asStoredPace(raw?.fiveK),
    tenK: asStoredPace(raw?.tenK),
    half: asStoredPace(raw?.half),
    full: asStoredPace(raw?.full),
  };
}

function asStoredPace(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

export function secondsToPaceParts(secondsPerKm: number): { minutes: number; seconds: number } {
  const rounded = Math.max(0, Math.round(secondsPerKm));
  return { minutes: Math.floor(rounded / 60), seconds: rounded % 60 };
}

export function formatPaceSpoken(secondsPerKm: number): string {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return "미등록";
  const { minutes, seconds } = secondsToPaceParts(secondsPerKm);
  return `${minutes}분 ${String(seconds).padStart(2, "0")}초/km`;
}

export function computeAveragePaceSeconds(distanceKm: number, totalSeconds: number): number | null {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(totalSeconds)) return null;
  if (distanceKm <= 0 || totalSeconds <= 0) return null;
  return Math.round(totalSeconds / distanceKm);
}

export function durationToInputParts(totalSeconds: number): { hours: string; minutes: string; seconds: string } {
  const clamped = Math.max(0, Math.round(totalSeconds));
  return {
    hours: String(Math.floor(clamped / 3600)),
    minutes: String(Math.floor((clamped % 3600) / 60)),
    seconds: String(clamped % 60),
  };
}

export function durationPartsToSeconds(hours: number, minutes: number, seconds: number): number | null {
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  if (hours < 0 || minutes < 0 || seconds < 0) return null;
  if (minutes > 59 || seconds > 59) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

export function validateDurationParts(hours: number, minutes: number, seconds: number): string | null {
  if (![hours, minutes, seconds].every(Number.isFinite)) return "시간은 숫자로 입력해 주세요.";
  if (hours < 0 || minutes < 0 || seconds < 0) return "시간은 0보다 작을 수 없습니다.";
  if (minutes > 59 || seconds > 59) return "분과 초는 0에서 59 사이여야 합니다.";
  if (hours === 0 && minutes === 0 && seconds === 0) return "걸린 시간은 0보다 커야 합니다.";
  return null;
}

export function validateDistanceKm(distanceKm: number): string | null {
  if (!Number.isFinite(distanceKm)) return "거리는 숫자로 입력해 주세요.";
  if (distanceKm <= 0) return "거리는 0보다 커야 합니다.";
  return null;
}

export function hasAnySavedPace(book: PaceBook): boolean {
  return PACE_SLOTS.some((slot) => book[slot.id] !== null);
}

const DISTANCE_PACE_SLOT_IDS: PaceSlotId[] = ["fiveK", "tenK", "half", "full"];

export function averagePaceSecondsFromDistanceSlots(book: PaceBook): number | null {
  const values = DISTANCE_PACE_SLOT_IDS.map((id) => book[id]).filter(
    (value): value is number => value !== null && value > 0,
  );
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function applyPaceSlot(
  book: PaceBook | undefined,
  slotId: PaceSlotId,
  value: number | null,
): PaceBook {
  return normalizePaceBook({
    ...book,
    [slotId]: value,
  });
}

export function defaultGoalPaceSeconds(book?: PaceBook | null): number | null {
  return book?.usual ?? null;
}

export function canRunWithoutPace(paceSeconds: number | null, paceSkipped: boolean): boolean {
  return paceSeconds !== null || paceSkipped;
}

export function effectiveRunPaceSeconds(
  paceSeconds: number | null,
  paceSkipped: boolean,
  book?: PaceBook | null,
): number | null {
  if (paceSeconds !== null) return paceSeconds;
  const usual = defaultGoalPaceSeconds(book);
  if (usual !== null) return usual;
  if (paceSkipped) return DEMO_OPEN_PACE_SECONDS;
  return null;
}

export function paceToSecondsPerKm(input: PaceInput): number {
  return input.minutes * 60 + input.seconds;
}

export function validatePace(input: PaceInput): string | null {
  if (!Number.isFinite(input.minutes) || !Number.isFinite(input.seconds)) {
    return "페이스는 숫자로 입력해 주세요.";
  }
  if (input.minutes < 0 || input.seconds < 0) {
    return "페이스는 0보다 작을 수 없습니다.";
  }
  if (input.seconds >= 60) {
    return "초는 0에서 59 사이여야 합니다.";
  }
  if (input.minutes === 0 && input.seconds === 0) {
    return "페이스는 0일 수 없습니다. 시간/km로 입력해 주세요.";
  }
  return null;
}

export function travelSeconds(distanceM: number, secondsPerKm: number): number {
  return (distanceM / 1000) * secondsPerKm;
}

export function formatPaceMarks(secondsPerKm: number): string {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return "--";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}′${String(s).padStart(2, "0")}″`;
}

export function formatPace(secondsPerKm: number): string {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return "--";
  return `${formatPaceMarks(secondsPerKm)} /km`;
}

export function formatDistanceKm(meters: number): string {
  if (!Number.isFinite(meters)) return "--";
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatWaitSec(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "예측 불가";
  return `${Math.round(seconds)}초`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--";
  const clamped = Math.max(0, Math.round(seconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

export function displayRoutePaceSeconds(
  route: { lengthM: number; averagePaceSeconds?: number | null },
  session?: { times: { totalElapsedSec: number }; progressM: number } | null,
): number | null {
  if (session && session.times.totalElapsedSec > 0) {
    const distanceM = session.progressM > 0 ? session.progressM : route.lengthM;
    const computed = elapsedPace(session.times.totalElapsedSec, distanceM);
    if (computed && computed > 0) return Math.round(computed);
  }
  if (route.averagePaceSeconds && route.averagePaceSeconds > 0) {
    return Math.round(route.averagePaceSeconds);
  }
  return null;
}

export function formatAveragePaceLabel(seconds: number | null): string {
  return seconds === null ? "평균 페이스 --" : `평균 페이스 ${formatPaceMarks(seconds)}`;
}

export function displayRouteElapsedSeconds(
  route: { lengthM: number; averagePaceSeconds?: number | null },
  session?: { times: { totalElapsedSec: number }; progressM: number } | null,
): number | null {
  if (session && session.times.totalElapsedSec > 0) {
    return Math.round(session.times.totalElapsedSec);
  }
  const pace = displayRoutePaceSeconds(route, session);
  if (pace && route.lengthM > 0) return Math.round(travelSeconds(route.lengthM, pace));
  return null;
}

export function movingPace(movingSec: number, distanceM: number): number | null {
  if (distanceM <= 0) return null;
  return movingSec / (distanceM / 1000);
}

export function elapsedPace(totalSec: number, distanceM: number): number | null {
  if (distanceM <= 0) return null;
  return totalSec / (distanceM / 1000);
}

export function addEstimates(a: TimeEstimate, b: TimeEstimate): TimeEstimate {
  if (a.kind === "unknown" || b.kind === "unknown") return { kind: "unknown" };
  if (a.kind === "exact" && b.kind === "exact") {
    return { kind: "exact", seconds: a.seconds + b.seconds };
  }
  const minA = a.kind === "exact" ? a.seconds : a.minSeconds;
  const maxA = a.kind === "exact" ? a.seconds : a.maxSeconds;
  const minB = b.kind === "exact" ? b.seconds : b.minSeconds;
  const maxB = b.kind === "exact" ? b.seconds : b.maxSeconds;
  return { kind: "range", minSeconds: minA + minB, maxSeconds: maxA + maxB };
}

export function formatEstimate(est: TimeEstimate): string {
  if (est.kind === "unknown") return "예측 불가";
  if (est.kind === "exact") return formatDuration(est.seconds);
  return `${formatDuration(est.minSeconds)}–${formatDuration(est.maxSeconds)}`;
}
