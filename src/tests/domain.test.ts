import { describe, expect, it } from "vitest";
import {
  DETOUR_PRESETS,
  INITIAL_DETOUR_MAX_M,
  INITIAL_DETOUR_RATIO,
  WAIT_DIFF_NEGLIGIBLE_SEC,
  WAIT_DETOUR_THRESHOLD_SEC,
} from "../config/app.ts";
import { SAMPLE_CARDS } from "../data/demo/catalog.ts";
import { NETWORKS } from "../data/demo/networks.ts";
import { DEMO_PLANS, createSignalLookup } from "../data/demo/signals.ts";
import { DemoSimClock, fixedClock } from "../domain/clock.ts";
import { routeFingerprint } from "../domain/fingerprint.ts";
import { localPoint } from "../domain/geo.ts";
import type {
  CrossingPlan,
  DirectedEdge,
  GraphEdge,
  PathCandidate,
  PathEvaluation,
  RunSession,
  SignalLookup,
  WalkingNetwork,
} from "../domain/models.ts";
import {
  canRunWithoutPace,
  applyPaceSlot,
  averagePaceSecondsFromDistanceSlots,
  computeAveragePaceSeconds,
  emptyPaceBook,
  defaultGoalPaceSeconds,
  effectiveRunPaceSeconds,
  displayRouteElapsedSeconds,
  displayRoutePaceSeconds,
  durationToInputParts,
  formatAveragePaceLabel,
  normalizePaceBook,
  travelSeconds,
  validateDurationParts,
  validatePace,
} from "../domain/pace.ts";
import { asDirected, dijkstra, enumeratePaths, pathThroughStops } from "../domain/pathfinding.ts";
import { countLaps, JustRunTracker, justRunLoopGeometry, summarizeJustRun } from "../domain/just-run.ts";
import { RunSimulator } from "../domain/run-simulation.ts";
import { filterCrossingMarks } from "../domain/crossing-marks.ts";
import { pacesFromSession } from "../domain/records-export.ts";
import { normalizeAppSettings, routingPolicyFromSettings } from "../domain/settings.ts";
import {
  allowedExtraMeters,
  buildReason,
  defaultRoutingPolicy,
  pickPreferredPath,
  planRoutes,
  withinDetourLimits,
} from "../domain/routing-policy.ts";
import {
  evaluatePath,
  needsDetourSearch,
  positiveModulo,
  waitAtCrossing,
} from "../domain/signals.ts";
import { evaluateTurns } from "../domain/turns.ts";
import { formatPopularElapsed, popularRunSummary } from "../domain/popular.ts";

const pace = 360;

function edge(
  id: string,
  from: string,
  to: string,
  lengthM: number,
  geometry: { x: number; y: number }[],
  kind: GraphEdge["walkKind"] = "sidewalk",
): GraphEdge {
  return {
    id,
    from,
    to,
    lengthM,
    geometry: geometry.map((p) => localPoint(p.x, p.y)),
    walkable: true,
    walkKind: kind,
    isStairs: kind === "stairs",
    isOverpass: kind === "overpass",
    geometryVersion: 1,
  };
}

function fixtureNetwork(): WalkingNetwork {
  const nodes = {
    A: { id: "A", point: localPoint(0, 0), kind: "intersection" as const },
    B: { id: "B", point: localPoint(500, 0), kind: "intersection" as const },
    C: { id: "C", point: localPoint(500, 200), kind: "intersection" as const },
    D: { id: "D", point: localPoint(0, 200), kind: "intersection" as const },
    P: { id: "P", point: localPoint(250, 80), kind: "park" as const },
    Z1: { id: "Z1", point: localPoint(80, 40), kind: "alley" as const },
    Z2: { id: "Z2", point: localPoint(160, 0), kind: "alley" as const },
    Z3: { id: "Z3", point: localPoint(240, 40), kind: "alley" as const },
    R1: { id: "R1", point: localPoint(0, 400), kind: "intersection" as const },
    R2: { id: "R2", point: localPoint(0, 700), kind: "intersection" as const },
  };
  const edges = {
    ab: edge("ab", "A", "B", 500, [{ x: 0, y: 0 }, { x: 500, y: 0 }]),
    bc: edge("bc", "B", "C", 200, [{ x: 500, y: 0 }, { x: 500, y: 200 }]),
    ap: edge("ap", "A", "P", 270, [{ x: 0, y: 0 }, { x: 120, y: 70 }, { x: 250, y: 80 }], "park_path"),
    pc: edge("pc", "P", "C", 270, [{ x: 250, y: 80 }, { x: 380, y: 90 }, { x: 500, y: 200 }], "park_path"),
    az1: edge("az1", "A", "Z1", 90, [{ x: 0, y: 0 }, { x: 80, y: 40 }], "alley"),
    z12: edge("z12", "Z1", "Z2", 90, [{ x: 80, y: 40 }, { x: 160, y: 0 }], "alley"),
    z23: edge("z23", "Z2", "Z3", 90, [{ x: 160, y: 0 }, { x: 240, y: 40 }], "alley"),
    z3c: edge("z3c", "Z3", "C", 300, [{ x: 240, y: 40 }, { x: 500, y: 200 }], "alley"),
    ad: edge("ad", "A", "D", 200, [{ x: 0, y: 0 }, { x: 0, y: 200 }]),
    dc: edge("dc", "D", "C", 500, [{ x: 0, y: 200 }, { x: 500, y: 200 }]),
  };
  return {
    regionId: "seoul",
    bounds: { minX: -20, minY: -20, maxX: 720, maxY: 720 },
    nodes,
    edges,
    features: [
      {
        kind: "river",
        id: "river",
        polygon: [localPoint(-20, 450), localPoint(200, 450), localPoint(200, 650), localPoint(-20, 650)],
      },
    ],
    places: [
      { placeId: "o", label: "A", point: nodes.A.point, nodeId: "A", source: "demo" },
      { placeId: "d", label: "C", point: nodes.C.point, nodeId: "C", source: "demo" },
    ],
    demoStartNodeId: "A",
    geometryVersion: 1,
    source: "demo",
  };
}

function planOf(directedEdgeId: string, referenceTimeSec: number): CrossingPlan {
  return {
    crossingId: "x1",
    directedEdgeId,
    label: "테스트 횡단",
    point: localPoint(500, 0),
    crossingWidthM: 10,
    cycleSeconds: 90,
    referenceTimeSec,
    greenEntryWindow: { startSec: 0, endSec: 25 },
    clearanceWindow: { startSec: 25, endSec: 32 },
    planValidity: { validFromSec: null, validToSec: null },
    source: "demo",
    freshness: "fresh",
    uncertaintySec: 0,
    capability: "fixed-plan",
  };
}

function candidate(edges: DirectedEdge[], id = "c1"): PathCandidate {
  return {
    id,
    directedEdges: edges,
    nodeIds: [edges[0].from, ...edges.map((e) => e.to)],
    lengthM: edges.reduce((s, e) => s + e.lengthM, 0),
    geometry: edges.flatMap((e, i) => (i === 0 ? e.geometry : e.geometry.slice(1))),
    fingerprint: routeFingerprint(
      edges.map((e) => e.directedEdgeId),
      1,
    ),
    viaLabel: "",
  };
}

describe("travel time", () => {
  it("6:00/km over 500m is 180 seconds", () => {
    expect(travelSeconds(500, 360)).toBe(180);
  });
});

describe("signal wait", () => {
  it("accumulates the first wait into the second arrival", () => {
    const network = fixtureNetwork();
    const ab = asDirected(network.edges.ab, true);
    const bc = asDirected(network.edges.bc, true);
    const signals: SignalLookup = {
      get(id) {
        if (id === ab.directedEdgeId) return planOf(id, 180 - 55);
        if (id === bc.directedEdgeId) return planOf(id, 0);
        return null;
      },
    };
    const ev = evaluatePath(candidate([ab, bc]), pace, 0, signals);
    const first = ev.crossings[0];
    const second = ev.crossings[1];
    expect(first.wait.kind).toBe("exact");
    expect(first.wait.kind === "exact" && first.wait.seconds).toBe(35);
    expect(second.arrival.kind).toBe("exact");
    if (first.departure.kind === "exact" && second.arrival.kind === "exact") {
      expect(second.arrival.seconds).toBe(first.departure.seconds + 200 / 1000 * pace);
    }
  });

  it("uses 15s inclusive threshold", () => {
    expect(needsDetourSearch(14.999)).toBe(false);
    expect(needsDetourSearch(15)).toBe(true);
    expect(needsDetourSearch(15.001)).toBe(true);
    expect(WAIT_DETOUR_THRESHOLD_SEC).toBe(15);
  });

  it("handles cycle wrap, negative modulo, green and clearance", () => {
    expect(positiveModulo(-10, 90)).toBe(80);
    const plan = planOf("e>", 0);
    const green = waitAtCrossing(5, plan, 10, pace);
    expect(green.kind === "exact" && green.seconds).toBe(0);
    const flash = waitAtCrossing(26, plan, 10, pace);
    expect(flash.kind === "exact" && flash.seconds).toBeGreaterThan(0);
    const late = waitAtCrossing(80, plan, 10, pace);
    expect(late.kind === "exact" && late.seconds).toBe(10);
  });

  it("does not treat flashing arrival as immediate entry", () => {
    const plan = planOf("e>", 0);
    const wait = waitAtCrossing(plan.clearanceWindow.startSec + 0.2, plan, 18, pace);
    expect(wait.kind === "exact" && wait.seconds).toBeGreaterThan(0);
  });
});

describe("routing policy", () => {
  it("is deterministic for same input, clock and seed", () => {
    const network = fixtureNetwork();
    const req = {
      origin: network.places[0],
      destination: network.places[1],
      waypoints: [],
      paceSecondsPerKm: pace,
      departure: { kind: "clock-start" as const, atSec: 0 },
      seed: 3,
      nowSec: 0,
    };
    const a = planRoutes(req, network, { get: () => null });
    const b = planRoutes(req, network, { get: () => null });
    expect("error" in a || "error" in b).toBe(false);
    if (!("error" in a) && !("error" in b)) {
      expect(a.chosen.candidate.fingerprint).toBe(b.chosen.candidate.fingerprint);
    }
  });

  it("changes arrival when pace changes", () => {
    const network = fixtureNetwork();
    const ab = asDirected(network.edges.ab, true);
    const plan = planOf(ab.directedEdgeId, 0);
    const fast = evaluatePath(candidate([ab]), 300, 0, { get: () => plan });
    const slow = evaluatePath(candidate([ab]), 420, 0, { get: () => plan });
    expect(fast.crossings[0].arrival).not.toEqual(slow.crossings[0].arrival);
  });

  it("scores a gentle park curve better than a sharp alley zigzag", () => {
    const curve = evaluateTurns([
      localPoint(0, 0),
      localPoint(40, 8),
      localPoint(80, 14),
      localPoint(120, 16),
      localPoint(160, 14),
      localPoint(200, 8),
    ]);
    const zig = evaluateTurns([
      localPoint(0, 0),
      localPoint(30, 40),
      localPoint(60, 0),
      localPoint(90, 40),
      localPoint(120, 0),
    ]);
    expect(curve.turnScore).toBeGreaterThan(zig.turnScore);
    expect(zig.zigzagPairs).toBeGreaterThan(0);
  });

  it("does not recommend a signal-free zigzag as the baseline", () => {
    const network = fixtureNetwork();
    const result = planRoutes(
      {
        origin: network.places[0],
        destination: network.places[1],
        waypoints: [],
        paceSecondsPerKm: pace,
        departure: { kind: "clock-start", atSec: 0 },
        seed: 1,
        nowSec: 0,
      },
      network,
      { get: () => null },
    );
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.chosen.candidate.directedEdges.some((e) => e.walkKind === "alley")).toBe(
        false,
      );
    }
  });

  it("uses the documented 10% detour cap and keeps baseline if no suitable alt", () => {
    expect(defaultRoutingPolicy.detourRatio).toBe(INITIAL_DETOUR_RATIO);
    const network = fixtureNetwork();
    const ab = asDirected(network.edges.ab, true);
    const lookup: SignalLookup = {
      get(id) {
        if (id === ab.directedEdgeId) return planOf(id, 180 - 55);
        return null;
      },
    };
    const result = planRoutes(
      {
        origin: network.places[0],
        destination: network.places[1],
        waypoints: [],
        paceSecondsPerKm: pace,
        departure: { kind: "clock-start", atSec: 0 },
        seed: 2,
        nowSec: 0,
      },
      network,
      lookup,
      { ...defaultRoutingPolicy, detourRatio: 0.02, waitThresholdSec: 15 },
    );
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.chosen.candidate.fingerprint).toBe(result.baseline.candidate.fingerprint);
    }
  });

  it("ranks by fewer stops, not a shorter max wait, and applies both detour caps", () => {
    expect(defaultRoutingPolicy.detourMaxM).toBe(INITIAL_DETOUR_MAX_M);
    expect(defaultRoutingPolicy.waitDiffNegligibleSec).toBe(WAIT_DIFF_NEGLIGIBLE_SEC);
    expect(withinDetourLimits(5000, 5200)).toBe(true);
    expect(withinDetourLimits(5000, 6200)).toBe(false);

    const sample = (id: string, lengthM: number, stopCount: number, wait: number): PathEvaluation => ({
      candidate: {
        id,
        directedEdges: [],
        nodeIds: [],
        lengthM,
        geometry: [],
        fingerprint: id,
        viaLabel: id,
      },
      travelSec: { kind: "exact", seconds: travelSeconds(lengthM, 360) },
      waitSec: { kind: "exact", seconds: wait },
      totalSec: { kind: "exact", seconds: travelSeconds(lengthM, 360) + wait },
      stopCount,
      signalCrossingCount: stopCount,
      knownCrossingCount: stopCount,
      unknownCrossingCount: 0,
      crossings: [],
      turnScore: 1,
      walkScore: 1,
      sharpTurns: 0,
      zigzagPairs: 0,
      maxExactWaitSec: wait,
      complete: true,
      paceAvailable: true,
      signalComparisonReady: true,
    });

    const a = sample("A", 5000, 1, 30);
    const b = sample("B", 5100, 3, 60);
    const c = sample("C", 5200, 0, 0);
    const d = sample("D", 6200, 0, 0);
    expect(pickPreferredPath(a, [b, c, d]).candidate.id).toBe("C");
    expect(buildReason(a, c, 360)).toBe(
      "200m 더 달리는 대신 예상 정지 1회를 줄여요. 총 소요시간은 약 42초 늘어나요.",
    );
    expect(buildReason(a, c, 360)).not.toMatch(/더 빠른/);
  });

  it("applies both detour ratio and max meters, and styles pick differently", () => {
    expect(allowedExtraMeters(2000, DETOUR_PRESETS.tight.ratio, DETOUR_PRESETS.tight.maxM)).toBe(100);
    expect(withinDetourLimits(2000, 2200, { ...defaultRoutingPolicy, ...DETOUR_PRESETS.tight, detourRatio: DETOUR_PRESETS.tight.ratio, detourMaxM: DETOUR_PRESETS.tight.maxM })).toBe(false);
    expect(withinDetourLimits(2000, 2090, { ...defaultRoutingPolicy, detourRatio: DETOUR_PRESETS.tight.ratio, detourMaxM: DETOUR_PRESETS.tight.maxM })).toBe(true);

    const sample = (id: string, lengthM: number, stopCount: number, wait: number): PathEvaluation => ({
      candidate: {
        id,
        directedEdges: [],
        nodeIds: [],
        lengthM,
        geometry: [],
        fingerprint: id,
        viaLabel: id,
      },
      travelSec: { kind: "exact", seconds: travelSeconds(lengthM, 360) },
      waitSec: { kind: "exact", seconds: wait },
      totalSec: { kind: "exact", seconds: travelSeconds(lengthM, 360) + wait },
      stopCount,
      signalCrossingCount: stopCount,
      knownCrossingCount: stopCount,
      unknownCrossingCount: 0,
      crossings: [],
      turnScore: 1,
      walkScore: 1,
      sharpTurns: 0,
      zigzagPairs: 0,
      maxExactWaitSec: wait,
      complete: true,
      paceAvailable: true,
      signalComparisonReady: true,
    });
    const baseline = sample("base", 4000, 2, 40);
    const costly = sample("costly", 4280, 1, 40);
    expect(
      pickPreferredPath(baseline, [costly], { ...defaultRoutingPolicy, recommendStyle: "balanced" }).candidate.id,
    ).toBe("base");
    expect(
      pickPreferredPath(baseline, [costly], { ...defaultRoutingPolicy, recommendStyle: "min-stops" }).candidate.id,
    ).toBe("costly");
  });

  it("prefers avoiding stairs when the setting is on, but can still include them", () => {
    const edge = (stairs: boolean) => ({
      directedEdgeId: stairs ? "s>" : "w>",
      edgeId: "e",
      from: "a",
      to: "b",
      lengthM: 20,
      geometry: [],
      walkKind: stairs ? ("stairs" as const) : ("sidewalk" as const),
      isStairs: stairs,
      isOverpass: false,
      walkable: true,
      geometryVersion: 1,
    });
    const sample = (id: string, stairs: boolean, stopCount: number): PathEvaluation => ({
      candidate: {
        id,
        directedEdges: [edge(stairs)],
        nodeIds: [],
        lengthM: 4000,
        geometry: [],
        fingerprint: id,
        viaLabel: id,
      },
      travelSec: { kind: "exact", seconds: 400 },
      waitSec: { kind: "exact", seconds: 0 },
      totalSec: { kind: "exact", seconds: 400 },
      stopCount,
      signalCrossingCount: stopCount,
      knownCrossingCount: stopCount,
      unknownCrossingCount: 0,
      crossings: [],
      turnScore: 1,
      walkScore: 1,
      sharpTurns: 0,
      zigzagPairs: 0,
      maxExactWaitSec: 0,
      complete: true,
      paceAvailable: true,
      signalComparisonReady: true,
    });
    const base = { ...sample("flat", false, 2), maxExactWaitSec: 20, waitSec: { kind: "exact" as const, seconds: 40 } };
    const stairs = sample("up", true, 0);
    expect(
      pickPreferredPath(base, [stairs], { ...defaultRoutingPolicy, recommendStyle: "min-stops", avoidStairs: true })
        .candidate.id,
    ).toBe("flat");
    expect(
      pickPreferredPath(base, [stairs], { ...defaultRoutingPolicy, recommendStyle: "min-stops", avoidStairs: false })
        .candidate.id,
    ).toBe("up");
  });

  it("keeps signal markers independent from route ranking", () => {
    const plan = planOf("e>", 0);
    const marks = [
      { plan, onRoute: true, info: "predictable" as const, waitSec: 8, next: true },
      { plan: { ...plan, crossingId: "near" }, onRoute: false, info: "unknown" as const, waitSec: null, next: false },
    ];
    expect(filterCrossingMarks(marks, { showRouteSignals: false, showNearbySignals: true, selectedCrossingId: plan.crossingId })).toHaveLength(2);
    expect(filterCrossingMarks(marks, { showRouteSignals: false, showNearbySignals: false }).map((m) => m.plan.crossingId)).toEqual([]);
    const policy = routingPolicyFromSettings(normalizeAppSettings({ showRouteSignals: false }));
    expect(policy.recommendStyle).toBe("balanced");
    expect(policy.detourRatio).toBe(INITIAL_DETOUR_RATIO);
  });

  it("does not invent a moving pace without moving time", () => {
    const session = {
      progressM: 1000,
      times: { movingSec: 0, signalWaitSec: 0, manualPauseSec: 0, totalElapsedSec: 360 },
    } as RunSession;
    const paces = pacesFromSession(session, 1000);
    expect(paces.movingPaceSeconds).toBeNull();
    expect(paces.overallPaceSeconds).toBe(360);
  });

  it("does not turn unknown signals into zero wait or a confirmed total", () => {
    const network = fixtureNetwork();
    const ab = asDirected(network.edges.ab, true);
    const ev = evaluatePath(candidate([ab]), pace, 0, { get: () => "unknown" });
    expect(ev.waitSec.kind).toBe("unknown");
    expect(ev.totalSec.kind).not.toBe("exact");
    expect(ev.complete).toBe(false);
    expect(ev.signalCrossingCount).toBe(1);
    expect(ev.unknownCrossingCount).toBe(1);
    expect(ev.signalComparisonReady).toBe(false);
  });

  it("does not confirm signal waits when pace is missing", () => {
    const network = fixtureNetwork();
    const ab = asDirected(network.edges.ab, true);
    const ev = evaluatePath(candidate([ab]), null, 0, { get: () => planOf(ab.directedEdgeId, 0) });
    expect(ev.paceAvailable).toBe(false);
    expect(ev.signalComparisonReady).toBe(false);
    expect(ev.waitSec.kind).toBe("unknown");
    expect(ev.complete).toBe(false);
  });

  it("does not invent a path across the river gap", () => {
    const city = NETWORKS.seoul;
    const fake = dijkstra(city, "n:880:800", "n:880:1120");
    if (fake) {
      const hops = fake.map((e) => e.from + "->" + e.to);
      expect(hops.some((h) => h === "n:880:800->n:880:1120")).toBe(false);
    }
    const viaBridge = dijkstra(city, "n:520:800", "n:520:1120");
    expect(viaBridge && viaBridge.length > 0).toBe(true);
  });
});

describe("run records", () => {
  it("excludes reverse and zero-distance from best-time comparison helpers", () => {
    expect(routeFingerprint(["a>", "b>"], 1)).not.toBe(routeFingerprint(["b<", "a<"], 1));
    const network = fixtureNetwork();
    const ab = asDirected(network.edges.ab, true);
    const ev = evaluatePath(candidate([ab]), pace, 0, { get: () => null });
    const sim = new RunSimulator(ev, fixedClock(0), pace);
    sim.finish(true);
    expect(sim.progressM).toBe(0);
    expect(sim.phase).toBe("completed");
  });

  it("pauses distance while manually paused", () => {
    const network = fixtureNetwork();
    const ab = asDirected(network.edges.ab, true);
    const ev = evaluatePath(candidate([ab]), pace, 0, { get: () => null });
    const clock = new DemoSimClock(0, 1);
    const sim = new RunSimulator(ev, clock, pace);
    sim.start();
    sim.pause("manual");
    const before = sim.progressM;
    sim.tick();
    expect(sim.progressM).toBe(before);
  });
});

describe("demo city", () => {
  it("plans cafe to hall in every demo region", () => {
    for (const regionId of ["seoul", "incheon", "daegu", "seongnam"] as const) {
      const network = NETWORKS[regionId];
      const origin = network.places[0];
      const destination = network.places[1];
      const result = planRoutes(
        {
          origin,
          destination,
          waypoints: [],
          paceSecondsPerKm: pace,
          departure: { kind: "clock-start", atSec: 0 },
          seed: 7,
          nowSec: 0,
        },
        network,
        createSignalLookup(DEMO_PLANS[regionId]),
      );
      expect("error" in result).toBe(false);
    }
  });

  it("enumerates more than one simple path for the verification pair", () => {
    const paths = enumeratePaths(NETWORKS.seoul, "n:880:160", "n:1600:480", [], 7);
    expect(paths.length).toBeGreaterThan(1);
  });

  it("can finish a simulated run by advancing an injected clock", () => {
    const network = NETWORKS.seoul;
    const result = planRoutes(
      {
        origin: network.places[0],
        destination: network.places[1],
        waypoints: [],
        paceSecondsPerKm: pace,
        departure: { kind: "clock-start", atSec: 0 },
        seed: 7,
        nowSec: 0,
      },
      network,
      createSignalLookup(DEMO_PLANS.seoul),
    );
    if ("error" in result) throw new Error(result.error);
    let t = 0;
    const clock = {
      nowSec() {
        return t;
      },
    };
    const sim = new RunSimulator(result.chosen, clock, pace);
    sim.start();
    for (let i = 0; i < 80; i += 1) {
      t += 30;
      sim.tick();
    }
    expect(sim.phase).toBe("completed");
    expect(sim.progressM).toBeGreaterThan(0);
  });
});

describe("pace calculator", () => {
  it("turns 5km in 32:30 into 6:30 per km", () => {
    expect(computeAveragePaceSeconds(5, 32 * 60 + 30)).toBe(390);
  });

  it("splits a finish time into hour-minute-second fields", () => {
    expect(durationToInputParts(32 * 60 + 30)).toEqual({
      hours: "0",
      minutes: "32",
      seconds: "30",
    });
  });

  it("rounds the average pace to the nearest second", () => {
    expect(computeAveragePaceSeconds(3, 1000)).toBe(333);
  });

  it("rejects zero distance or time", () => {
    expect(computeAveragePaceSeconds(0, 100)).toBeNull();
    expect(computeAveragePaceSeconds(5, 0)).toBeNull();
  });

  it("keeps seconds in 0-59", () => {
    expect(validatePace({ minutes: 6, seconds: 60 })).toMatch(/초/);
    expect(validateDurationParts(0, 60, 0)).toMatch(/59/);
    expect(validatePace({ minutes: 0, seconds: 0 })).toMatch(/0/);
  });

  it("prefers a session pace over a stored route pace", () => {
    expect(
      displayRoutePaceSeconds({ lengthM: 5000, averagePaceSeconds: 400 }, {
        times: { totalElapsedSec: 32 * 60 + 30 },
        progressM: 5000,
      }),
    ).toBe(390);
    expect(formatAveragePaceLabel(390)).toBe("평균 페이스 6′30″");
    expect(formatAveragePaceLabel(null)).toBe("평균 페이스 --");
    expect(
      displayRouteElapsedSeconds({ lengthM: 1000, averagePaceSeconds: 360 }, null),
    ).toBe(360);
  });

  it("keeps usual pace independent from distance slots", () => {
    const withUsual = applyPaceSlot(emptyPaceBook(), "usual", 390);
    const withFull = applyPaceSlot(withUsual, "full", 420);
    expect(withFull.usual).toBe(390);
    expect(withFull.full).toBe(420);
    const withFive = applyPaceSlot(withFull, "fiveK", 300);
    expect(withFive.usual).toBe(390);
    const removedFive = applyPaceSlot(withFive, "fiveK", null);
    expect(removedFive.fiveK).toBeNull();
    expect(removedFive.usual).toBe(390);
    expect(averagePaceSecondsFromDistanceSlots(withFive)).toBe(360);
  });

  it("does not invent distance records from a usual pace", () => {
    const book = normalizePaceBook({ usual: 390 });
    expect(book.usual).toBe(390);
    expect(book.fiveK).toBeNull();
    expect(book.tenK).toBeNull();
    expect(book.half).toBeNull();
    expect(book.full).toBeNull();
    expect(defaultGoalPaceSeconds(book)).toBe(390);
    expect(defaultGoalPaceSeconds(normalizePaceBook({}))).toBeNull();
  });

  it("lets a skipped pace open the run without storing a goal", () => {
    expect(canRunWithoutPace(null, false)).toBe(false);
    expect(canRunWithoutPace(null, true)).toBe(true);
    expect(canRunWithoutPace(390, true)).toBe(true);
    expect(effectiveRunPaceSeconds(null, true, normalizePaceBook({}))).toBe(360);
    expect(effectiveRunPaceSeconds(390, true, normalizePaceBook({}))).toBe(390);
    expect(effectiveRunPaceSeconds(null, true, normalizePaceBook({ usual: 330 }))).toBe(330);
    expect(effectiveRunPaceSeconds(null, false, normalizePaceBook({}))).toBeNull();
  });
});

describe("mapped path distance", () => {
  it("uses the walking path length, not a straight line", () => {
    const network = NETWORKS.seoul;
    const origin = network.places[0];
    const destination = network.places[1];
    const built = pathThroughStops(network, [origin.nodeId, destination.nodeId]);
    expect(built).not.toBeNull();
    const straight = Math.hypot(
      destination.point.x - origin.point.x,
      destination.point.y - origin.point.y,
    );
    expect(built!.lengthM).toBeGreaterThanOrEqual(straight - 1e-6);
  });

  it("can close a loop through a waypoint", () => {
    const network = NETWORKS.seoul;
    const [start, via] = network.places;
    const built = pathThroughStops(network, [start.nodeId, via.nodeId, start.nodeId]);
    expect(built).not.toBeNull();
    expect(built!.lengthM).toBeGreaterThan(0);
  });

  it("returns null instead of a made-up distance", () => {
    expect(pathThroughStops(NETWORKS.seoul, ["missing-a", "missing-b"])).toBeNull();
  });
});

describe("just run", () => {
  it("records a virtual track then computes distance, laps, and pace", () => {
    const center = localPoint(0, 0);
    const tracker = new JustRunTracker(360, center);
    tracker.start(0);
    tracker.tick(360_000);
    const summary = tracker.finish(360_000);
    expect(tracker.times.totalElapsedSec).toBeCloseTo(360, 5);
    expect(summary.distanceM).toBeGreaterThan(0);
    expect(summary.paceSeconds).not.toBeNull();
    expect(summary.laps).toBeGreaterThanOrEqual(0);
  });

  it("counts a lap when the track returns to the start", () => {
    const loop = justRunLoopGeometry(localPoint(0, 0));
    expect(countLaps(loop, loop[0])).toBeGreaterThanOrEqual(1);
    const none = summarizeJustRun([loop[0]], 0);
    expect(none.distanceM).toBe(0);
    expect(none.paceSeconds).toBeNull();
  });
});

describe("popular run stats", () => {
  it("formats breakthrough time in minutes", () => {
    expect(formatPopularElapsed(null)).toBe("정보 없음");
    expect(formatPopularElapsed(45)).toBe("45초");
    expect(formatPopularElapsed(180)).toBe("3분");
    expect(formatPopularElapsed(272)).toBe("4분 32초");
  });

  it("shows sample author, elapsed, and pace on downtown daegu card", () => {
    const card = SAMPLE_CARDS.find((item) => item.cardId === "daegu:downtown");
    expect(card).toBeTruthy();
    const summary = popularRunSummary(card!);
    expect(summary.author).toBe("샘플");
    expect(summary.elapsed).not.toBe("정보 없음");
    expect(summary.pace).toBe("6′00″");
    expect(summary.recordNote).toContain("샘플 기록");
  });
});
