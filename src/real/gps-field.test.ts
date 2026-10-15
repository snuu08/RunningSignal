import { describe, expect, it } from "vitest";
import { GPS_FIELD_SCHEMA, summarizeGpsField, type GpsFieldReport } from "./gps-field.ts";
import type { LiveRun } from "./useGpsRun.ts";

function report(distanceM: number, activeSec: number): GpsFieldReport {
  return {
    schema: GPS_FIELD_SCHEMA, source: "browser-geolocation", mode: "distance", referenceM: 1000,
    userAgent: "test", droppedEvents: 0,
    events: Array.from({ length: 20 }, (_, i) => ({
      type: "sample" as const, at: i * activeSec / 19 * 1000, accepted: true, reason: "recorded", distanceM: i * 50,
      fix: { coord: [127.03, 37.51], at: i * activeSec / 19 * 1000, accuracy: i === 19 ? 100 : 5 },
    })),
    run: { id: "test", startedAt: 0, phase: "ended", activeSec, manualPauseSec: 0, lastTick: activeSec * 1000,
      route: null, track: { fixes: [], distanceM, gapSec: 0, stoppedSec: 0 } } as LiveRun,
  };
}

describe("field GPS evidence summary", () => {
  it("compares measured distance against an independent reference", () => {
    const result = summarizeGpsField(report(970, 360));
    expect(result.errorPercent).toBe(-3);
    expect(result.accuracyP95M).toBe(5);
    expect(result.verdict).toBe("within-trial-limit");
    expect(summarizeGpsField(report(1060, 360)).verdict).toBe("review");
  });
  it("does not pass an unfinished, empty, or interrupted measurement", () => {
    const unfinished = report(1000, 360);
    unfinished.run!.phase = "running";
    expect(summarizeGpsField(unfinished).verdict).toBe("insufficient");
    const interrupted = report(1000, 360);
    interrupted.run!.track.gapSec = 60;
    expect(summarizeGpsField(interrupted).verdict).toBe("review");
    interrupted.events = [];
    expect(summarizeGpsField(interrupted).verdict).toBe("insufficient");
  });
  it("requires two minutes of stationary evidence and exposes excessive drift", () => {
    const stationary = report(0, 119);
    stationary.mode = "stationary";
    expect(summarizeGpsField(stationary).verdict).toBe("insufficient");
    stationary.run!.activeSec = 120;
    expect(summarizeGpsField(stationary).verdict).toBe("within-trial-limit");
    stationary.run!.track.distanceM = 25;
    expect(summarizeGpsField(stationary).verdict).toBe("review");
  });
  it("does not pass a truncated log and retains visibility evidence", () => {
    const truncated = report(1000, 360);
    truncated.droppedEvents = 1;
    truncated.events.push({ type: "hidden", at: 10_000 });
    expect(summarizeGpsField(truncated)).toMatchObject({ hiddenCount: 1, verdict: "review" });
  });
  it("flags missing final samples even when the run ends before the next fix", () => {
    const missingTail = report(1000, 360);
    missingTail.run!.lastTick += 60_000;
    expect(summarizeGpsField(missingTail)).toMatchObject({ verdict: "review", unobservedTailSec: 60 });
  });
});
