import { describe, expect, it } from "vitest";
import type { Forecast } from "../../core.ts";
import { liveSignalGuidance } from "./liveSignalGuidance.ts";

const nowMs = Date.parse("2026-09-17T15:00:00+09:00");

function baseForecast(overrides: Partial<Forecast["crossings"][number]> = {}): Forecast {
  return {
    totalSec: 0,
    waitSec: 0,
    stops: 0,
    maxWaitSec: 0,
    crossings: [
      {
        id: "x1",
        arrivalMs: nowMs + 60_000,
        waitSec: 0,
        atM: 100,
        widthM: 8,
        plan: {
          cycleSec: 60,
          epochMs: nowMs,
          entryStartSec: 0,
          entryEndSec: 20,
          clearEndSec: 30,
          validFromMs: nowMs - 60_000,
          validToMs: nowMs + 3_600_000,
          verifiedAtMs: nowMs,
          uncertaintySec: 1,
        },
        ...overrides,
      },
    ],
  };
}

describe("liveSignalGuidance", () => {
  it("calculates a specific slower pace only when it reaches the next green entry window", () => {
    const source = baseForecast({ atM: 500 });
    source.crossings[0].plan!.entryStartSec = 6;
    const guidance = liveSignalGuidance({ routeForecast: source, traveledM: 0, livePace: 360, nowMs });
    expect(guidance?.waitSec).toBe(7);
    expect(guidance?.suggestedPace).toBe(376);
    expect(guidance?.guidance).toMatch(/6:16/);
  });
  it("does not suggest a large slowdown or a sprint to beat a signal", () => {
    const guidance = liveSignalGuidance({ routeForecast: baseForecast(), traveledM: 0, livePace: 360, nowMs });
    expect(guidance?.waitSec).toBeGreaterThan(20);
    expect(guidance?.suggestedPace).toBeNull();
  });
  it("keeps current state separate from arrival prediction", () => {
    const guidance = liveSignalGuidance({
      routeForecast: baseForecast(),
      traveledM: 0,
      livePace: 600,
      nowMs,
    });
    expect(guidance?.current).toMatch(/현재 보행신호/);
    expect(guidance?.arrival).toMatch(/예상 도착 시 신호/);
  });

  it("returns unknown when plan is unavailable instead of a false zero", () => {
    const guidance = liveSignalGuidance({
      routeForecast: baseForecast({ plan: undefined }),
      traveledM: 0,
      livePace: 600,
      nowMs,
    });
    expect(guidance?.waitSec).toBeNull();
    expect(guidance?.arrival).toMatch(/미확인/);
  });

  it("prioritizes safety near the next crossing", () => {
    const guidance = liveSignalGuidance({
      routeForecast: baseForecast(),
      traveledM: 80,
      livePace: 600,
      nowMs,
    });
    expect(guidance?.remainM).toBe(20);
    expect(guidance?.guidance).toMatch(/안전/);
  });
  it("uses a live window with no fixed plan and refuses its stale continuation", () => {
    const source = baseForecast({ plan: null, atM: 100, liveWindow: {
      observedAtMs: nowMs, state: "red", stateEndsAtMs: nowMs + 38_000,
      greenStartsAtMs: nowMs + 38_000, greenEndsAtMs: nowMs + 78_000, uncertaintySec: 1,
    } });
    const guidance = liveSignalGuidance({ routeForecast: source, traveledM: 0, livePace: 360, nowMs });
    expect(guidance?.waitSec).toBe(3);
    expect(guidance?.current).toMatch(/적색/);
    expect(guidance?.suggestedPace).toBe(400);
    expect(liveSignalGuidance({ routeForecast: source, traveledM: 0, livePace: 360,
      nowMs: nowMs + 10_001 })?.waitSec).toBeNull();
  });
});
