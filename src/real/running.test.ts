import { describe, expect, it } from "vitest";
import {
  realPage,
  suggestedUsualFromRecords,
  sustainedOffRoute,
  TRIAL_OFF_ROUTE,
} from "./running.ts";
import { normalizeProfile } from "./storage.ts";
import type { RunRecord } from "./storage.ts";

function rec(partial: {
  distanceM: number;
  activeSec: number;
  gapSec?: number;
}): RunRecord {
  return {
    id: "x",
    owner: "guest",
    title: "t",
    route: null,
    routeKey: "k",
    track: {
      fixes: [],
      distanceM: partial.distanceM,
      gapSec: partial.gapSec ?? 0,
      stoppedSec: 0,
    },
    activeSec: partial.activeSec,
    manualPauseSec: 0,
    elapsedSec: partial.activeSec,
    startedAt: 1,
    finishedAt: 2,
    complete: true,
    synced: false,
  };
}

describe("running helpers", () => {
  it("migrates a legacy single pace into the usual slot", () => {
    expect(normalizeProfile({ pace: 390 }).paces.usual).toBe(390);
    expect(normalizeProfile({ pace: 390 }).pace).toBe(390);
  });
  it("maps / and /real to home", () => {
    expect(realPage("/")).toBe("home");
    expect(realPage("/real")).toBe("home");
    expect(realPage("/real/")).toBe("home");
    expect(realPage("/real/settings")).toBe("settings");
    expect(realPage("/real/diagnostics")).toBe("diagnostics");
  });
  it("does not treat one GPS spike as off-route", () => {
    expect(sustainedOffRoute([{ offRouteM: 80, accuracy: 8 }])).toBe(false);
    const hits = Array.from({ length: TRIAL_OFF_ROUTE.consecutiveFixes }, () => ({
      offRouteM: 80,
      accuracy: 8,
    }));
    expect(sustainedOffRoute(hits)).toBe(true);
    expect(
      sustainedOffRoute([
        ...hits.slice(0, -1),
        { offRouteM: 80, accuracy: 40 },
      ]),
    ).toBe(false);
  });
  it("averages eligible runs as total time over total distance", () => {
    const s = suggestedUsualFromRecords([
      rec({ distanceM: 1000, activeSec: 360 }),
      rec({ distanceM: 2000, activeSec: 720 }),
      rec({ distanceM: 0, activeSec: 100 }),
      rec({ distanceM: 1500, activeSec: 400, gapSec: 80 }),
    ]);
    expect(s.paceSec).toBe(360);
    expect(s.used).toBe(2);
    expect(s.skipped).toBe(2);
    expect(s.reason).not.toMatch(/신호 없는/);
  });
  it("does not invent a 0 pace from empty or gappy-only records", () => {
    expect(suggestedUsualFromRecords([]).paceSec).toBeNull();
    expect(
      suggestedUsualFromRecords([rec({ distanceM: 50, activeSec: 20 })]).paceSec,
    ).toBeNull();
  });
});
