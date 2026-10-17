import { describe, expect, it } from "vitest";
import { assessCrossingField, candidateCoord, crossingCandidates, pedestrianFieldLight, SEOUL_CROSSING_CATALOG,
  type CrossingFieldReport, type FieldLight } from "./crossing-field.ts";

// Synthetic observations exercise review gates. They are not field evidence.
function report(): CrossingFieldReport {
  const intersection = SEOUL_CROSSING_CATALOG.intersections[0];
  const crossing = intersection.crossings.find((c) => c.hasSignal)!;
  const [lon, lat] = candidateCoord(crossing)!;
  const at = Date.parse("2026-10-17T03:00:00Z");
  const states: FieldLight[] = ["red", "red", "red", "green", "green", "green", "red", "red", "red", "green", "green", "green", "red"];
  return { version: 1, itstId: intersection.tdataIntersectionId, managementId: crossing.managementId, direction: "nt",
    entry: { coord: [lon - .00005, lat], accuracyM: 3, atMs: at },
    exit: { coord: [lon + .0001, lat], accuracyM: 3, atMs: at },
    observations: states.map((observed, i) => ({ observed, observedAtMs: at + i * 10_000, sample: {
      itstId: intersection.tdataIntersectionId, deviceId: "synthetic-controller", sourceTimestampMs: at + i * 10_000,
      fetchedAtMs: at + i * 10_000 + 500, states: { nt: {
        status: observed === "red" ? "stop-and-remain" : "permissive-movement-allowed", raw: 1000 - i % 3 * 100,
      } },
    } })) };
}
describe("physical crossing review evidence", () => {
  it("keeps actual official facility IDs, historical geometry and provider identity uncertainty", () => {
    expect(SEOUL_CROSSING_CATALOG.intersections).toHaveLength(3);
    expect(SEOUL_CROSSING_CATALOG.intersections.flatMap((i) => i.crossings)).toHaveLength(13);
    expect(SEOUL_CROSSING_CATALOG.intersections.every((i) => i.identityStatus === "name-candidate-only")).toBe(true);
    const selected = crossingCandidates("20386")!;
    expect(selected.crossings.some((c) => c.hasSignal && c.managementId === "06-0000002643" && c.tgisIntersectionId === "1183")).toBe(true);
    const point = candidateCoord(selected.crossings[0])!;
    expect(point[0]).toBeGreaterThan(126.8); expect(point[0]).toBeLessThan(127);
    expect(point[1]).toBeGreaterThan(37.5); expect(point[1]).toBeLessThan(37.6);
    expect(crossingCandidates("1183")).toBeNull();
  });
  it("allows review after good GPS, source-paired states, two cycles and a measured unit; never activates predictions", () => {
    expect(assessCrossingField(report())).toMatchObject({ readyForReview: true, reasons: [], greenStarts: 2, redStarts: 2,
      physicalCrossingVerified: false, predictionReady: false, unit: { unit: "deciseconds" } });
  });
  it("rejects inaccurate GPS and distant or identical endpoints", () => {
    const r = report(); r.entry!.accuracyM = 20; r.exit!.coord = r.entry!.coord;
    expect(assessCrossingField(r).reasons).toEqual(expect.arrayContaining(["entry_accurate_gps_required", "crossing_length_invalid"]));
    r.entry!.accuracyM = 3; r.exit!.coord = [127.5, 37.5];
    expect(assessCrossingField(r).reasons).toContain("exit_outside_candidate");
  });
  it.each(["stale", "wrong-id", "wrong-state", "duplicate", "out-of-order"])("rejects %s observations", (kind) => {
    const r = report();
    if (kind === "stale") r.observations[0].sample.sourceTimestampMs -= 6000;
    if (kind === "wrong-id") r.observations[0].sample.itstId = "9999";
    if (kind === "wrong-state") r.observations[0].observed = "green";
    if (kind === "duplicate") r.observations[1].sample.sourceTimestampMs = r.observations[0].sample.sourceTimestampMs;
    if (kind === "out-of-order") r.observations.reverse();
    expect(assessCrossingField(r).readyForReview).toBe(false);
  });
  it("requires two cycles and rejects observations from different devices or field sessions", () => {
    const r = report(); r.observations = r.observations.slice(0, 6);
    r.observations[1].sample.deviceId = "another-controller";
    r.entry!.atMs -= 31 * 60_000;
    expect(assessCrossingField(r).reasons).toEqual(expect.arrayContaining(["two_cycles_required", "same_controller_required", "same_field_session_required"]));
  });
  it("never equates yellow vehicle transitions or unavailable states with pedestrian flashing", () => {
    expect(pedestrianFieldLight("permissive-clearance")).toBe("flashing");
    expect(pedestrianFieldLight("stop-Then-Proceed")).toBeNull();
    expect(pedestrianFieldLight("unavailable")).toBeNull();
  });
});
