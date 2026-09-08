import { describe, expect, it } from "vitest";
import {
  appendFix,
  forecast,
  meters,
  preferSignalRoute,
  rankRoutes,
  routeCompleted,
  routeKey,
  samplePath,
  trackSegments,
  type Crossing,
  type FixedPlan,
  type Forecast,
  type Route,
  type Track,
} from "./core.ts";
const epoch = 1800000000000;
const plan: FixedPlan = {
  cycleSec: 60,
  epochMs: epoch,
  entryStartSec: 0,
  entryEndSec: 20,
  clearEndSec: 30,
  validFromMs: epoch - 1000,
  validToMs: epoch + 3600000,
  verifiedAtMs: epoch,
  uncertaintySec: 0,
};
const crossing = (atM: number, id = "a"): Crossing => ({
  id,
  atM,
  name: id,
  widthM: 10,
  plan,
});
const route = (
  id: string,
  distanceM = 1000,
  sharpTurns = 0,
  zigzags = 0,
): Route => ({
  id,
  distanceM,
  sharpTurns,
  zigzags,
  option: "0",
  name: id,
  coordinates: [
    [127, 37],
    [127 + Number(id) / 10000, 37.01],
  ],
  instructions: [],
});
const prediction = (max: number | null, stops = 1): Forecast => ({
  waitSec: max,
  maxWaitSec: max,
  stops,
  totalSec: max === null ? null : 360 + max,
  crossings: [],
});
describe("arrival-aware signal policy", () => {
  it("uses actual route meters and accumulates earlier waits", () => {
    const r = forecast(
      200,
      360,
      epoch,
      [crossing(100), crossing(200, "b")],
      true,
      epoch,
    );
    expect(r.crossings[0].arrivalMs).toBe(epoch + 36000);
    expect(r.crossings[0].waitSec).toBe(24);
    expect(r.crossings[1].arrivalMs).toBe(epoch + 96000);
    expect(r.waitSec).toBe(48);
    expect(r.totalSec).toBe(120);
  });
  it("does not turn unmapped coverage into zero signals", () => {
    expect(forecast(1000, 360, epoch, [], false, epoch).waitSec).toBeNull();
  });
  it("only returns zero for explicitly complete signal-free coverage", () => {
    expect(forecast(1000, 360, epoch, [], true, epoch).waitSec).toBe(0);
  });
  it("does not extrapolate a current state or missing plan", () => {
    expect(
      forecast(200, 360, epoch, [{ ...crossing(100), plan: null }], true, epoch)
        .totalSec,
    ).toBeNull();
  });
  it("makes downstream arrival unknown after an unknown wait", () => {
    const r = forecast(
      200,
      360,
      epoch,
      [{ ...crossing(100), plan: null }, crossing(200, "b")],
      true,
      epoch,
    );
    expect(r.crossings[1].arrivalMs).toBeNull();
  });
  it("rejects stale and expired plans", () => {
    expect(
      forecast(200, 360, epoch, [crossing(100)], true, epoch + 61000).waitSec,
    ).toBeNull();
    expect(
      forecast(
        200,
        360,
        epoch,
        [{ ...crossing(100), plan: { ...plan, validToMs: epoch + 40000 } }],
        true,
        epoch,
      ).waitSec,
    ).toBeNull();
  });
  it("does not allow entry during clearance", () => {
    expect(
      forecast(100, 360, epoch + 25000, [crossing(0)], true, epoch).waitSec,
    ).toBe(35);
  });
  it("rejects impossible crossing windows and malformed cycle", () => {
    expect(
      forecast(100, 360, epoch, [{ ...crossing(0), widthM: 200 }], true, epoch)
        .waitSec,
    ).toBeNull();
    expect(
      forecast(
        100,
        360,
        epoch,
        [{ ...crossing(0), plan: { ...plan, cycleSec: 0 } }],
        true,
        epoch,
      ).waitSec,
    ).toBeNull();
  });
  it("keeps a straight route under 15 seconds but considers alternatives at exactly 15", () => {
    const base = { route: route("1"), forecast: prediction(14.999) },
      alternative = { route: route("2", 1050), forecast: prediction(0, 0) };
    expect(preferSignalRoute([base, alternative])?.route.id).toBe("1");
    expect(
      preferSignalRoute([{ ...base, forecast: prediction(15) }, alternative])
        ?.route.id,
    ).toBe("2");
  });
  it("never prefers an unknown, long, or zigzag detour", () => {
    const base = { route: route("1"), forecast: prediction(30) };
    expect(
      preferSignalRoute([
        base,
        { route: route("2", 1300), forecast: prediction(0, 0) },
        { route: route("3", 1050, 6, 3), forecast: prediction(0, 0) },
        { route: route("4"), forecast: prediction(null, 0) },
      ])?.route.id,
    ).toBe("1");
  });
});
describe("real distance and GPS", () => {
  const empty: Track = { fixes: [], distanceM: 0, gapSec: 0, stoppedSec: 0 };
  it("keeps longitude/latitude order and kilometers separate", () => {
    expect(meters([127, 37], [127, 37.001])).toBeCloseTo(111.2, 0);
  });
  it("rejects inaccurate fixes and impossible jumps", () => {
    const first = appendFix(empty, {
      coord: [127, 37],
      accuracy: 5,
      at: epoch,
    });
    expect(
      appendFix(first, { coord: [128, 38], accuracy: 5, at: epoch + 1000 }),
    ).toBe(first);
    expect(
      appendFix(first, {
        coord: [127, 37.001],
        accuracy: 70,
        at: epoch + 1000,
      }),
    ).toBe(first);
  });
  it("accumulates small regular running steps rather than discarding all sub-5m motion", () => {
    let t = empty;
    for (let i = 0; i <= 30; i++)
      t = appendFix(t, {
        coord: [127, 37 + i * 0.00003],
        accuracy: 8,
        at: epoch + i * 1000,
      });
    expect(t.distanceM).toBeGreaterThan(90);
    expect(t.distanceM).toBeLessThan(105);
  });
  it("does not count movement while GPS was suspended or manually paused", () => {
    const a = appendFix(empty, { coord: [127, 37], accuracy: 5, at: epoch });
    const b = appendFix(a, {
      coord: [127, 37.01],
      accuracy: 5,
      at: epoch + 60000,
    });
    expect(b.distanceM).toBe(0);
    expect(b.gapSec).toBe(60);
    const c = appendFix(a, {
      coord: [127, 37.01],
      accuracy: 5,
      at: epoch + 60000,
      segmentStart: true,
    });
    expect(c.distanceM).toBe(0);
    expect(c.gapSec).toBe(0);
    expect(trackSegments(c.fixes)).toEqual([]);
  });
  it("does not mark a shortcut as completion just because endpoints match", () => {
    const r = route("1");
    const t = {
      ...empty,
      distanceM: 1000,
      fixes: [
        { coord: r.coordinates[0], at: epoch, accuracy: 5 },
        { coord: r.coordinates[1], at: epoch + 360000, accuracy: 5 },
      ],
    };
    expect(routeCompleted(r, t)).toBe(false);
  });
  it("can recognize a fully tracked route", () => {
    const r = {
      ...route("1"),
      coordinates: [
        [127, 37],
        [127, 37.009],
      ] as [number, number][],
    };
    const t = {
      ...empty,
      distanceM: 1000,
      fixes: samplePath(r.coordinates, 10).map((coord, i) => ({
        coord,
        at: epoch + i * 3000,
        accuracy: 5,
      })),
    };
    expect(routeCompleted(r, t)).toBe(true);
  });
  it("deduplicates same direction and preserves the reverse as a different course", () => {
    const r = route("1");
    expect(rankRoutes([r, { ...r, id: "duplicate" }])).toHaveLength(1);
    expect(routeKey(r.coordinates)).not.toBe(
      routeKey([...r.coordinates].reverse()),
    );
  });
  it("filters excessively long alternatives before offering another route", () => {
    expect(rankRoutes([route("1"), route("2", 1200)])).toHaveLength(1);
  });
});
