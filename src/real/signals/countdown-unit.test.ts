import { describe, expect, it } from "vitest";
import { countdownSample, estimateCountdownUnit, type CountdownSample } from "./countdown-unit.ts";

function samples(rate = 10): CountdownSample[] {
  return Array.from({ length: 6 }, (_, i) => ({ itstId: "123", deviceId: "synthetic-device",
    sourceTimestampMs: 100_000 + i * 5000, fetchedAtMs: 101_000 + i * 5000,
    states: { ne: { status: "stop-and-remain", raw: 5000 - i * 5 * rate } } }));
}
function payload() {
  return { resultClass: "ok-data", observation: { fresh: true, synchronized: true },
    current: { itstId: "123", sourceTimestampMs: 100_000, fetchedAtMs: 101_000,
      stale: false, missingSourceTime: false },
    data: [{ itstId: "123", eqmnId: "synthetic-device", trsmUtcTime: 100_000,
      nePdsgStatNm: "stop-And-Remain", nePdsgRmdrCs: 500 }] };
}
describe("source-clock countdown calibration", () => {
  it.each([{ rate: 10, unit: "deciseconds" }, { rate: 100, unit: "centiseconds" }])(
    "identifies $unit from multiple source-clock intervals", ({ rate, unit }) => {
      expect(estimateCountdownUnit(samples(rate), "ne")).toMatchObject({ unit, pairs: 5,
        observedSourceSec: 25, unitsPerSecond: rate, reason: "measured" });
    });
  it("uses source time despite variable HTTP delivery delay", () => {
    const s = samples();
    s.forEach((x, i) => { x.fetchedAtMs += i % 2 ? 8000 : 0; });
    expect(estimateCountdownUnit(s, "ne").unit).toBe("deciseconds");
  });
  it("does not guess from a single pair or repeated cached packets", () => {
    expect(estimateCountdownUnit(samples().slice(0, 2), "ne").unit).toBeNull();
    expect(estimateCountdownUnit(Array(6).fill(samples()[0]), "ne").unit).toBeNull();
  });
  it("does not combine another intersection, equipment or a state transition", () => {
    for (const mutation of [
      (s: CountdownSample) => { s.itstId = "999"; },
      (s: CountdownSample) => { s.deviceId = "another-device"; },
      (s: CountdownSample) => { s.states.ne!.status = "permissive-movement-allowed"; },
    ]) {
      const s = samples(); mutation(s[3]);
      expect(estimateCountdownUnit(s, "ne").unit).toBeNull();
    }
  });
  it("rejects a reset or frozen countdown instead of averaging it away", () => {
    const s = samples(); s[3].states.ne!.raw = s[2].states.ne!.raw;
    expect(estimateCountdownUnit(s, "ne")).toMatchObject({ unit: null, reason: "inconsistent" });
  });
  it("keeps source and unit evidence separate from crossing verification", () => {
    expect(countdownSample(payload(), "123")).toMatchObject({ itstId: "123",
      deviceId: "synthetic-device", states: { ne: { status: "stop-and-remain", raw: 500 } } });
    expect(countdownSample(payload(), "999")).toBeNull();
    expect(estimateCountdownUnit(samples(), "nt").unit).toBeNull();
  });
  it("rejects stale, unpaired and mismatched source packets", () => {
    const stale = payload(); stale.current.fetchedAtMs = 111_000;
    expect(countdownSample(stale, "123")).toBeNull();
    const unpaired = payload(); unpaired.observation.synchronized = false;
    expect(countdownSample(unpaired, "123")).toBeNull();
    const wrongTime = payload(); wrongTime.data[0].trsmUtcTime++;
    expect(countdownSample(wrongTime, "123")).toBeNull();
    const wrongDevice = payload(); wrongDevice.data[0].eqmnId = "";
    expect(countdownSample(wrongDevice, "123")).toBeNull();
    const duplicate = payload(); duplicate.data.push({ ...duplicate.data[0] });
    expect(countdownSample(duplicate, "123")).toBeNull();
  });
});
