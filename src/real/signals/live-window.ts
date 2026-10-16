import type { TdataPedestrianMapping } from "./provider.ts";
import { latestTdataRow, sourceTimeOf } from "./tdata.ts";

/** A single observed green interval. There is no assumed repeating cycle. */
export type LiveSignalWindow = {
  observedAtMs: number;
  state: "red" | "green";
  stateEndsAtMs: number;
  greenStartsAtMs: number;
  greenEndsAtMs: number;
  uncertaintySec: number;
};
export const LIVE_SIGNAL_MAX_AGE_MS = 10_000;
export const LIVE_SIGNAL_MAX_HORIZON_SEC = 300;

export function tdataMappingIsVerified(mapping: TdataPedestrianMapping, nowMs: number): boolean {
  return /^(nt|et|st|wt|ne|se|sw|nw)$/.test(mapping.direction) &&
    ["deciseconds", "centiseconds"].includes(mapping.remainingUnit) &&
    Number.isFinite(mapping.verifiedAtMs) && mapping.verifiedAtMs > 0 && mapping.verifiedAtMs <= nowMs &&
    typeof mapping.evidence === "string" && mapping.evidence.trim().length > 0;
}

/** Convert only the verified pedestrian head and unit, using the source clock. */
export function seoulLiveWindow(body: unknown, itstId: string, mapping: TdataPedestrianMapping,
  nowMs: number): LiveSignalWindow | null {
  if (!tdataMappingIsVerified(mapping, nowMs)) return null;
  const row = latestTdataRow(body, itstId);
  if (!row) return null;
  const at = sourceTimeOf(row);
  if (at === null || nowMs - at > LIVE_SIGNAL_MAX_AGE_MS || at > nowMs + 1000) return null;
  const raw = row[`${mapping.direction}PdsgRmdrCs`];
  if (!(typeof raw === "number" || (typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim())))) return null;
  const remainingSec = Number(raw) / (mapping.remainingUnit === "deciseconds" ? 10 : 100);
  if (!(remainingSec > 0 && remainingSec <= LIVE_SIGNAL_MAX_HORIZON_SEC)) return null;
  // Trial margin, not a claim of measured field accuracy. Mapping may require more.
  const uncertaintySec = mapping.countdownUncertaintySec ?? 1;
  if (!Number.isFinite(uncertaintySec) || uncertaintySec < 1 || uncertaintySec > 3) return null;
  const end = at + remainingSec * 1000;
  const status = String(row[`${mapping.direction}PdsgStatNm`] ?? "").toLowerCase();
  if (status === "protected-movement-allowed") return {
    observedAtMs: at, state: "green", stateEndsAtMs: end,
    greenStartsAtMs: at, greenEndsAtMs: end, uncertaintySec,
  };
  // Red remaining can mean time until another state, not necessarily pedestrian green.
  // A verified minimum green duration is needed to include crossing clearance.
  const minimumGreenSec = mapping.minimumGreenSec;
  if (status === "stop-and-remain" && mapping.redEndsAtEntryStart === true &&
    minimumGreenSec !== undefined && Number.isFinite(minimumGreenSec) &&
    minimumGreenSec > 0 && remainingSec + minimumGreenSec <= LIVE_SIGNAL_MAX_HORIZON_SEC) return {
    observedAtMs: at, state: "red", stateEndsAtMs: end,
    greenStartsAtMs: end, greenEndsAtMs: end + minimumGreenSec * 1000, uncertaintySec,
  };
  return null;
}

/** Returns null after this one window; never extrapolates another cycle. */
export function waitInLiveWindow(window: LiveSignalWindow, arrivalMs: number, crossingSec: number,
  nowMs: number): number | null {
  if (![window.observedAtMs, window.stateEndsAtMs, window.greenStartsAtMs,
    window.greenEndsAtMs, window.uncertaintySec, arrivalMs, crossingSec, nowMs].every(Number.isFinite) ||
    !["red", "green"].includes(window.state) ||
    nowMs - window.observedAtMs > LIVE_SIGNAL_MAX_AGE_MS || window.observedAtMs > nowMs + 1000 ||
    crossingSec <= 0 || window.uncertaintySec < 1 || window.uncertaintySec > 3 ||
    window.stateEndsAtMs <= window.observedAtMs ||
    window.greenStartsAtMs < window.observedAtMs || window.greenEndsAtMs <= window.greenStartsAtMs ||
    window.greenEndsAtMs - window.observedAtMs > LIVE_SIGNAL_MAX_HORIZON_SEC * 1000 ||
    (window.state === "red" ? window.stateEndsAtMs !== window.greenStartsAtMs :
      window.greenStartsAtMs !== window.observedAtMs || window.stateEndsAtMs !== window.greenEndsAtMs) ||
    arrivalMs < window.observedAtMs - 1000) return null;
  const firstEntry = window.greenStartsAtMs + window.uncertaintySec * 1000;
  const lastEntry = window.greenEndsAtMs - (crossingSec + window.uncertaintySec) * 1000;
  const entryMs = Math.max(arrivalMs, firstEntry);
  if (entryMs >= lastEntry) return null;
  return Math.max(0, (firstEntry - arrivalMs) / 1000);
}
