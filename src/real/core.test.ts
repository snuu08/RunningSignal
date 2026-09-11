import { describe, expect, it } from "vitest";
import {
  appendFix,
  applyWalkingPolicy,
  forecast,
  meters,
  nextPoi,
  poisFromInstructions,
  preferFewerCrossings,
  preferSignalRoute,
  progressOnRoute,
  rankRoutes,
  routeCompleted,
  routeKey,
  samplePath,
  scanFacilities,
  trackSegments,
  withGeometry,
  type Crossing,
  type FixedPlan,
  type Forecast,
  type Route,
  type Track,
} from "./core.ts";
import { waitDisplay, candidateIndex, remainingRawDisplay } from "./api-contract.ts";
import {
  parseRoutingPolicy,
  policyFromProfile,
  TRIAL_ROUTING_POLICY,
} from "./routing-policy.ts";
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
  it("uses the same trial extra-distance cap as walking rank, not a separate 500m screen cap", () => {
    const base = { route: route("1"), forecast: prediction(30) };
    const far = { route: route("2", 1140), forecast: prediction(0, 0) };
    expect(preferSignalRoute([base, far])?.route.id).toBe("1");
    expect(
      preferSignalRoute([base, far], {
        ...TRIAL_ROUTING_POLICY,
        detourRatio: 0.15,
        detourMaxM: 500,
      })?.route.id,
    ).toBe("2");
  });
  it("keeps the walking baseline when waits are unknown rather than treating them as zero", () => {
    const base = { route: route("1"), forecast: prediction(null) };
    const alt = { route: route("2", 1050), forecast: prediction(null, 0) };
    expect(preferSignalRoute([base, alt])?.route.id).toBe("1");
    expect(waitDisplay(base.forecast).known).toBe(false);
    expect(waitDisplay(prediction(0, 0)).known).toBe(true);
    expect(waitDisplay(prediction(0, 0)).waitSec).toBe(0);
    expect(remainingRawDisplay(36001)).not.toMatch(/초$/);
    expect(remainingRawDisplay(36001)).toMatch(/원본 36001/);
    expect(remainingRawDisplay(null)).toBe("잔여값 없음");
    expect(candidateIndex([{ id: "a" }, { id: "b" }], "b")).toBe(1);
    expect(candidateIndex([{ id: "a" }], "missing")).toBe(0);
  });
});
describe("shared walking policy", () => {
  it("does not treat TMAP payload order as the baseline", () => {
    const wide: Route = {
      ...route("4", 1100, 4, 3),
      id: "tmap-4",
      option: "4",
      coordinates: [
        [127, 37],
        [127.01, 37],
        [127.01, 37.01],
      ],
    };
    const stairsFree: Route = {
      ...route("30", 1120, 0, 0),
      id: "tmap-30",
      option: "30",
      coordinates: [
        [127, 37],
        [127, 37.01],
      ],
    };
    expect(applyWalkingPolicy([wide, stairsFree]).routes[0].id).toBe("tmap-30");
  });
  it("applies stairs filter before extra-distance ranking", () => {
    const wide: Route = {
      ...route("4", 1000),
      id: "tmap-4",
      option: "4",
      hasStairs: true,
    };
    const stairsFree: Route = {
      ...route("30", 1080),
      id: "tmap-30",
      option: "30",
    };
    const out = applyWalkingPolicy([wide, stairsFree], {
      ...TRIAL_ROUTING_POLICY,
      avoidStairs: true,
    });
    expect(out.routes.map((r) => r.id)).toEqual(["tmap-30"]);
  });
  it("maps profile ratios to the documented trial max meters", () => {
    expect(policyFromProfile({ detour: 0.05, avoidStairs: true, avoidOverpass: false, avoidAlley: false }).detourMaxM).toBe(150);
    expect(policyFromProfile({ detour: 0.1, avoidStairs: true, avoidOverpass: false, avoidAlley: false }).detourMaxM).toBe(300);
    expect(policyFromProfile({ detour: 0.15, avoidStairs: true, avoidOverpass: false, avoidAlley: false }).detourMaxM).toBe(500);
    expect(parseRoutingPolicy({ detourRatio: 0.05 }).detourMaxM).toBe(150);
  });
  it("filters 200m extra at 10%/300m trial defaults", () => {
    expect(rankRoutes([route("1"), route("2", 1200)])).toHaveLength(1);
    expect(
      rankRoutes([route("1"), route("2", 1140)], 0.15, 500).map((r) => r.id),
    ).toEqual(["1", "2"]);
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
describe("straight-line and remaining distance", () => {
  it("measures extra path length against the origin-destination geodesic", () => {
    const bent: Route = {
      ...route("bent", 2000),
      coordinates: [
        [127, 37],
        [127.01, 37],
        [127.01, 37.01],
      ],
    };
    const fit = withGeometry(bent);
    expect(fit.straightM).toBeCloseTo(meters([127, 37], [127.01, 37.01]), 0);
    expect(fit.extraM).toBeGreaterThan(400);
    expect(fit.maxOffLineM).toBeGreaterThan(400);
  });
  it("tracks remaining meters along the path, not the straight shortcut", () => {
    const path: [number, number][] = [
      [127, 37],
      [127, 37.005],
      [127, 37.01],
    ];
    const mid = progressOnRoute(path, [127, 37.005]);
    expect(mid.traveledM).toBeCloseTo(meters(path[0], path[1]), 0);
    expect(mid.remainM).toBeCloseTo(meters(path[1], path[2]), 0);
    expect(progressOnRoute(path, [127.002, 37.005]).offRouteM).toBeGreaterThan(
      100,
    );
  });
  it("keeps TMAP crossing texts as places, not as predicted waits", () => {
    const pois = poisFromInstructions({
      ...route("1"),
      instructions: [
        { coord: [127, 37.005], text: "횡단보도를 건너세요" },
        { coord: [127, 37.008], text: "직진하세요" },
      ],
    });
    expect(pois).toHaveLength(1);
    expect(nextPoi(pois, 0)?.name).toMatch(/횡단/);
    expect(forecast(1000, 360, epoch, [], false, epoch).waitSec).toBeNull();
  });
  it("uses walk speed for crossing time, not the runner pace", () => {
    const fast = forecast(0, 180, epoch + 19000, [crossing(0)], true, epoch);
    expect(fast.waitSec).toBeGreaterThan(0);
  });
  it("marks overpass avoidance unconfirmed when no facility flags exist", () => {
    const out = applyWalkingPolicy([route("0")], {
      ...TRIAL_ROUTING_POLICY,
      avoidOverpass: true,
    });
    expect(out.avoidance.overpass).toBe("unconfirmed");
    expect(out.routes).toHaveLength(1);
  });
});
describe("crossing count rank and facilities", () => {
  it("moves a unique shorter-crossing candidate first without inventing waits", () => {
    const a = {
      ...route("1", 1000),
      nearbyPois: [{ id: "x", name: "횡단", coord: [127, 37] as [number, number], atM: 100, offPathM: 0, source: "tmap-instruction" as const }, { id: "y", name: "횡단", coord: [127, 37.01] as [number, number], atM: 200, offPathM: 0, source: "tmap-instruction" as const }],
    };
    const b = {
      ...route("2", 1050),
      nearbyPois: [{ id: "z", name: "횡단", coord: [127, 37] as [number, number], atM: 100, offPathM: 0, source: "tmap-instruction" as const }],
    };
    expect(preferFewerCrossings([a, b])[0].id).toBe("2");
  });
  it("treats TMAP stairs/overpass codes from payload text, not as wait seconds", () => {
    expect(
      scanFacilities([
        { properties: { facilityType: "15", description: "계단" } },
        { properties: { facilityType: "14", description: "횡단보도" } },
      ]),
    ).toEqual({ hasStairs: true, hasOverpass: false, hasAlley: false, facilityHints: true });
    expect(
      scanFacilities([{ properties: { description: "육교로 이동" } }]).hasOverpass,
    ).toBe(true);
  });
});
