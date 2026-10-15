import type { GpsRunEvent, LiveRun } from "./useGpsRun.ts";

export const GPS_FIELD_SCHEMA = "flowrun-gps-field-v1";
export const GPS_FIELD_EVENT_LIMIT = 12_000;
export type GpsFieldReport = {
  schema: typeof GPS_FIELD_SCHEMA;
  source: "browser-geolocation";
  mode: "stationary" | "distance";
  referenceM: number;
  userAgent: string;
  events: GpsRunEvent[];
  droppedEvents: number;
  run: LiveRun | null;
};

/** Local measurement aid. Passing these trial limits is not device certification. */
export function summarizeGpsField(report: GpsFieldReport) {
  const samples = report.events.filter((event) => event.type === "sample");
  const accepted = samples.filter((event) => event.accepted);
  const accuracies = samples.map((event) => event.fix.accuracy)
    .filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const distanceM = report.run?.track.distanceM ?? 0;
  const activeSec = report.run?.activeSec ?? 0;
  const gapSec = report.run?.track.gapSec ?? 0;
  const lastSampleAt = accepted.reduce((at, event) => Math.max(at, event.fix.at), report.run?.startedAt ?? 0);
  const lastPauseAt = report.events.reduce((at, event) => event.type === "pause" ? Math.max(at, event.at) : at, 0);
  const lastResumeAt = report.events.reduce((at, event) => event.type === "resume" ? Math.max(at, event.at) : at, 0);
  const observedUntil = lastPauseAt > lastResumeAt ? lastPauseAt : report.run?.lastTick ?? lastSampleAt;
  const tailSec = Math.max(0, (observedUntil - Math.max(lastSampleAt, lastResumeAt)) / 1000);
  const unobservedTailSec = tailSec > 15 ? tailSec : 0;
  const accuracyP95M = accuracies.length
    ? accuracies[Math.ceil(accuracies.length * 0.95) - 1] : null;
  const errorPercent = report.mode === "distance" && report.referenceM > 0
    ? (distanceM - report.referenceM) / report.referenceM * 100 : null;
  const enough = report.run?.phase === "ended" && accepted.length >= 10 &&
    (report.mode === "stationary" ? activeSec >= 120 :
      report.referenceM >= 100 && report.referenceM <= 50_000 && distanceM >= report.referenceM * 0.5);
  const withinTrialLimit = enough && gapSec === 0 && unobservedTailSec === 0 && report.droppedEvents === 0 &&
    (report.mode === "stationary" ? distanceM <= 10 : Math.abs(errorPercent!) <= 5);
  return {
    sampleCount: samples.length, acceptedCount: accepted.length,
    rejectedCount: samples.length - accepted.length,
    distanceM, activeSec, gapSec, unobservedTailSec, accuracyP95M, errorPercent,
    hiddenCount: report.events.filter((event) => event.type === "hidden").length,
    verdict: !enough ? "insufficient" as const : withinTrialLimit ? "within-trial-limit" as const : "review" as const,
  };
}
