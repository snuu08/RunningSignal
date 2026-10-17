import catalog from "../../../data/signals/catalog/2026-10-17/seoul-crossing-candidates.json";
import { meters, validCoord, type Coord } from "../core.ts";
import { fromEpsg5186 } from "./geo-crs.ts";
import { estimateCountdownUnit, type CountdownSample, type SignalDirection } from "./countdown-unit.ts";

export const SEOUL_CROSSING_CATALOG = catalog;
export type CrossingCandidate = typeof catalog.intersections[number]["crossings"][number];
export type FieldLight = "red" | "green" | "flashing" | "off";
export type CrossingFix = { coord: Coord; accuracyM: number; atMs: number };
export type CrossingFieldObservation = { observedAtMs: number; observed: FieldLight; sample: CountdownSample };
export type CrossingFieldReport = {
  version: 1;
  itstId: string;
  managementId: string;
  direction: SignalDirection;
  entry: CrossingFix | null;
  exit: CrossingFix | null;
  observations: CrossingFieldObservation[];
};
export function crossingCandidates(itstId: string) {
  return catalog.intersections.find((item) => item.tdataIntersectionId === itstId) ?? null;
}
export function candidateCoord(candidate: CrossingCandidate): Coord | null {
  return fromEpsg5186(candidate.point5186[0], candidate.point5186[1]);
}
export function pedestrianFieldLight(status: string): FieldLight | null {
  switch (status.toLowerCase()) {
    case "stop-and-remain": return "red";
    case "permissive-movement-allowed":
    case "protected-movement-allowed": return "green";
    case "permissive-clearance":
    case "protected-clearance": return "flashing";
    case "dark": return "off";
    default: return null;
  }
}
export function assessCrossingField(report: CrossingFieldReport) {
  const candidate = crossingCandidates(report.itstId)?.crossings.find((c) => c.managementId === report.managementId);
  const reasons: string[] = [];
  if (!candidate || !candidate.hasSignal) reasons.push("signalized_crossing_required");
  const point = candidate ? candidateCoord(candidate) : null;
  for (const [name, fix] of [["entry", report.entry], ["exit", report.exit]] as const) {
    if (!fix || !validCoord(fix.coord) || !Number.isFinite(fix.atMs) || fix.atMs <= 0 ||
      !Number.isFinite(fix.accuracyM) || fix.accuracyM < 0 || fix.accuracyM > 10)
      reasons.push(`${name}_accurate_gps_required`);
    else if (!point || meters(point, fix.coord) > 80) reasons.push(`${name}_outside_candidate`);
  }
  const lengthM = report.entry && report.exit && validCoord(report.entry.coord) && validCoord(report.exit.coord)
    ? meters(report.entry.coord, report.exit.coord) : null;
  if (lengthM !== null && (lengthM < 5 || lengthM > 80)) reasons.push("crossing_length_invalid");
  const observations = report.observations;
  if (observations.length < 6) reasons.push("more_observations_required");
  const devices = new Set(observations.map((o) => o.sample.deviceId));
  if (devices.size !== 1 || devices.has("")) reasons.push("same_controller_required");
  const seen = new Set<number>();
  for (const o of observations) {
    const state = o.sample.states[report.direction];
    if (o.sample.itstId !== report.itstId || !Number.isFinite(o.observedAtMs) ||
      Math.abs(o.observedAtMs - o.sample.sourceTimestampMs) > 5000 ||
      o.sample.fetchedAtMs < o.observedAtMs || o.sample.fetchedAtMs - o.observedAtMs > 5000 ||
      !state || pedestrianFieldLight(state.status) !== o.observed || seen.has(o.sample.sourceTimestampMs))
      reasons.push("state_or_time_mismatch");
    seen.add(o.sample.sourceTimestampMs);
  }
  let greenStarts = 0, redStarts = 0;
  for (let i = 1; i < observations.length; i++) {
    const a = observations[i - 1], b = observations[i];
    if (b.observedAtMs <= a.observedAtMs || b.sample.sourceTimestampMs <= a.sample.sourceTimestampMs)
      reasons.push("observation_order_invalid");
    if (a.observed === "red" && b.observed === "green") greenStarts++;
    if ((a.observed === "green" || a.observed === "flashing") && b.observed === "red") redStarts++;
  }
  if (greenStarts < 2 || redStarts < 2) reasons.push("two_cycles_required");
  if (observations.length && report.entry && report.exit) {
    const times = [report.entry.atMs, report.exit.atMs, ...observations.map((o) => o.observedAtMs)];
    if (Math.max(...times) - Math.min(...times) > 30 * 60_000) reasons.push("same_field_session_required");
  }
  const unit = estimateCountdownUnit(observations.map((o) => o.sample), report.direction);
  if (!unit.unit) reasons.push("countdown_unit_required");
  return { readyForReview: reasons.length === 0, reasons: [...new Set(reasons)],
    greenStarts, redStarts, lengthM, unit,
    // Matching field observations are review evidence, never automatic permission
    // to publish a physical mapping or to compute future signal windows.
    physicalCrossingVerified: false, predictionReady: false };
}
