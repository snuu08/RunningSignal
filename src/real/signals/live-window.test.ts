import { describe, expect, it } from "vitest";
import { forecast, forecastRemaining, type Crossing } from "../core.ts";
import { waitDisplay } from "../api-contract.ts";
import { seoulLiveWindow, waitInLiveWindow, type LiveSignalWindow } from "./live-window.ts";
import type { TdataPedestrianMapping } from "./provider.ts";

const now = Date.parse("2026-10-17T00:00:00Z");
const mapping: TdataPedestrianMapping = { crossingInternalId: "test-crossing", direction: "nt",
  remainingUnit: "deciseconds", verifiedAtMs: now - 60_000, evidence: "Synthetic verified mapping fixture" };
const body = (extra: Record<string, unknown> = {}) => [{ itstId: "1850", trsmUtcTime: now,
  ntPdsgStatNm: "protected-Movement-Allowed", ntPdsgRmdrCs: 600, ...extra }];
const red: LiveSignalWindow = { observedAtMs: now, state: "red", stateEndsAtMs: now + 60_000,
  greenStartsAtMs: now + 60_000, greenEndsAtMs: now + 100_000, uncertaintySec: 1 };
const crossing: Crossing = { id: "test-crossing", name: "test", atM: 50, exitAtM: 62, widthM: 12,
  plan: null, liveWindow: red };

describe("one-window live waiting forecast", () => {
  it("creates only the observed green interval and compensates for source age", () => {
    const window = seoulLiveWindow(body(), "1850", mapping, now + 2000)!;
    expect(window.greenEndsAtMs).toBe(now + 60_000);
    expect(waitInLiveWindow(window, now + 20_000, 13, now + 2000)).toBe(0);
    expect(waitInLiveWindow(window, now + 60_000, 13, now + 2000)).toBeNull();
  });
  it("requires verified red-to-green semantics and a green lower bound", () => {
    const stop = body({ ntPdsgStatNm: "stop-And-Remain" });
    expect(seoulLiveWindow(stop, "1850", mapping, now)).toBeNull();
    expect(seoulLiveWindow(stop, "1850", { ...mapping, redEndsAtEntryStart: true }, now)).toBeNull();
    const window = seoulLiveWindow(stop, "1850", { ...mapping, redEndsAtEntryStart: true, minimumGreenSec: 40 }, now);
    expect(window).toEqual(red);
  });
  it.each([null, "", -1, 0, 65535, true, [600], "unknown", Infinity])("refuses missing/sentinel remaining value %s", (value) => {
    expect(seoulLiveWindow(body({ ntPdsgRmdrCs: value }), "1850", mapping, now)).toBeNull();
  });
  it("refuses stale, future, wrong-direction, flashing and unverified observations", () => {
    expect(seoulLiveWindow(body(), "1850", mapping, now + 10_001)).toBeNull();
    expect(seoulLiveWindow(body({ trsmUtcTime: now + 1001 }), "1850", mapping, now)).toBeNull();
    expect(seoulLiveWindow(body(), "9999", mapping, now)).toBeNull();
    expect(seoulLiveWindow(body(), "1850", { ...mapping, direction: "wt" }, now)).toBeNull();
    expect(seoulLiveWindow(body({ ntPdsgStatNm: "protected-Clearance" }), "1850", mapping, now)).toBeNull();
    expect(seoulLiveWindow(body(), "1850", { ...mapping, evidence: "" }, now)).toBeNull();
  });
  it("uses the verified scale rather than treating raw deciseconds as seconds", () => {
    expect(seoulLiveWindow(body({ ntPdsgRmdrCs: 6000 }), "1850", mapping, now)).toBeNull();
    expect(seoulLiveWindow(body({ ntPdsgRmdrCs: 6000 }), "1850", { ...mapping, remainingUnit: "centiseconds" }, now)?.greenEndsAtMs).toBe(now + 60_000);
  });
  it("uses actual pace for arrival and adds previous waiting plus crossing time", () => {
    const next = { ...crossing, id: "next", atM: 100, exitAtM: 112,
      liveWindow: { ...red, stateEndsAtMs: now + 70_000, greenStartsAtMs: now + 70_000, greenEndsAtMs: now + 110_000 } };
    const result = forecast(200, 360, now, [crossing, next], true, now);
    expect(result.crossings[0].arrivalMs).toBe(now + 18_000);
    expect(result.crossings[0].waitSec).toBe(43);
    expect(result.crossings[1].arrivalMs).toBeCloseTo(now + 87_680);
    expect(result.crossings[1].waitSec).toBe(0);
    expect(result.waitSec).toBe(43);
    expect(forecast(200, 600, now, [crossing], true, now).waitSec).toBe(31);
    expect(result.validUntilMs).toBeGreaterThan(now);
    expect(result.validUntilMs).toBeLessThanOrEqual(now + 10_000);
    expect(waitDisplay(result, now + 10_000).known).toBe(false);
  });
  it("does not repeat a cycle, guess unknown coverage or omit walking clearance", () => {
    expect(forecast(1000, 360, now, [{ ...crossing, atM: 500, exitAtM: 512 }], true, now).waitSec).toBeNull();
    expect(forecast(200, 360, now, [crossing], false, now).waitSec).toBeNull();
    expect(forecast(200, 360, now, [{ ...crossing, widthM: 60 }], true, now).waitSec).toBeNull();
    expect(forecast(200, 360, now, [crossing], true, now + 10_001).waitSec).toBeNull();
  });
  it("keeps a first prediction but unknown total when a later crossing exceeds its horizon", () => {
    const result = forecast(1000, 360, now, [crossing, { ...crossing, id: "later", atM: 500, exitAtM: 512 }], true, now);
    expect(result.crossings[0].waitSec).toBe(43);
    expect(result.crossings[1].waitSec).toBeNull();
    expect(result.waitSec).toBeNull();
    expect(result.totalSec).toBeNull();
  });
  it("expires an idle planner's green estimate before the latest crossing entry", () => {
    const green = seoulLiveWindow(body({ ntPdsgRmdrCs: 200 }), "1850", mapping, now)!;
    const result = forecast(200, 360, now, [{ ...crossing, atM: 10, exitAtM: 22, liveWindow: green }], true, now);
    expect(result.waitSec).toBe(0);
    expect(result.validUntilMs).toBe(now + 2400);
    expect(waitDisplay(result, now + 2400).known).toBe(false);
  });
  it("does not count passed waits again and walks the remainder of a crossing", () => {
    const result = forecastRemaining(200, 360, now, [crossing], true, 56, now);
    expect(result.crossings).toEqual([]);
    expect(result.waitSec).toBe(0);
    expect(result.totalSec).toBeCloseTo(5 + 138 * 0.36);
  });
});
