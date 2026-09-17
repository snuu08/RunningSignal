import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { forecast, type Crossing, type FixedPlan, type Route } from "../core.ts";
import {
  CROSSING_BUFFER_SEC,
  CROSSING_WALK_M_PER_SEC,
} from "../../config/app.ts";
import { validateCrossing, validatePlan } from "./validate.ts";
import { toRuntimeCrossing } from "./to-engine.ts";
import { selectOperatingPlan } from "./select-plan.ts";
import { evaluateObservations } from "./mae.ts";
import { classifyCollected } from "./collect.ts";
import { remainingRawCs, interpretCurrentState } from "./tdata.ts";
import { coverageCopy, recommendSentences } from "../recommend-copy.ts";
import { crossingsAlongRoute } from "./along-route.ts";
import {
  createVerifiedProvider,
  parsePredictionScopes,
  parseVerifiedBundle,
} from "./provider.ts";
import { auditVerifiedBundle } from "./audit.ts";
import type { CrossingRecord, FieldObservation, OperatingPlanRecord } from "./schema.ts";

const epoch = 1800000000000;
const crossingRow = {
  source: "field",
  sourceCrossingId: "N-entry",
  sourceIntersectionId: "1537",
  entryLon: "126.9780",
  entryLat: "37.5665",
  exitLon: "126.9782",
  exitLat: "37.5667",
  bearingDeg: "45",
  directionLabel: "NE",
  directionEvidence: "field survey matched PED group to NE crossing",
  pedestrianSignalGroupId: "tdata:1537:ntPdsg",
  crossingLengthM: "22",
  paintedWidthM: "4",
  geometryType: "crossing-endpoints",
  stage: "verified",
  synthetic: "false",
};
const planRow = {
  source: "field",
  sourcePlanId: "TOD-1",
  version: "v1",
  sourceIntersectionId: "1537",
  pedestrianSignalGroupId: "tdata:1537:ntPdsg",
  cycleSec: "60",
  epochMs: String(epoch),
  entryStartSec: "0",
  entryEndSec: "20",
  clearEndSec: "30",
  validFromMs: "0",
  validToMs: "2000000000000",
  uncertaintySec: "0",
  operationMode: "fixed",
  planVerifiedAt: String(epoch),
  currentPlanConfirmedAt: String(epoch),
  stage: "verified",
  startHm: "00:00",
  endHm: "24:00",
  weekdays: "1,2,3,4,5,6,7",
};

const pilotDeparture = Date.parse("2026-09-17T15:00:00+09:00");

function fixedPlan(overrides: Partial<FixedPlan> = {}): FixedPlan {
  return {
    cycleSec: 60,
    epochMs: pilotDeparture,
    entryStartSec: 30,
    entryEndSec: 55,
    clearEndSec: 60,
    validFromMs: pilotDeparture - 600_000,
    validToMs: pilotDeparture + 3_600_000,
    verifiedAtMs: pilotDeparture,
    uncertaintySec: 0,
    ...overrides,
  };
}

function routeAt(id: string, coordinates: [number, number][]): Route {
  return {
    id,
    name: id,
    option: "0",
    distanceM: 200,
    sharpTurns: 0,
    zigzags: 0,
    coordinates,
    instructions: [],
  };
}

describe("plan clock selection", () => {
  it("selects weekday, midnight wrap, holiday, and skips reserve-like specials", () => {
    const base = validatePlan(planRow).ok as OperatingPlanRecord;
    const night = validatePlan({
      ...planRow,
      sourcePlanId: "NIGHT",
      startHm: "22:00",
      endHm: "06:00",
      weekdays: "1,2,3,4,5",
    }).ok as OperatingPlanRecord;
    const holiday = validatePlan({
      ...planRow,
      sourcePlanId: "HOLI",
      specialDayIds: "seoul-newyear",
      weekdays: "",
    }).ok as OperatingPlanRecord;
    const thuNoon = Date.parse("2026-09-10T12:00:00+09:00");
    const friNight = Date.parse("2026-09-11T23:30:00+09:00");
    const satDawn = Date.parse("2026-09-12T01:00:00+09:00");
    expect(selectOperatingPlan([base], { source: "field", sourceIntersectionId: "1537", pedestrianSignalGroupId: "tdata:1537:ntPdsg" }, thuNoon).plan?.sourcePlanId).toBe("TOD-1");
    expect(selectOperatingPlan([night], { source: "field", sourceIntersectionId: "1537", pedestrianSignalGroupId: "tdata:1537:ntPdsg" }, friNight).plan?.sourcePlanId).toBe("NIGHT");
    expect(selectOperatingPlan([night], { source: "field", sourceIntersectionId: "1537", pedestrianSignalGroupId: "tdata:1537:ntPdsg" }, satDawn).reason).toBe("no_plan_for_clock");
    expect(
      selectOperatingPlan([holiday], { source: "field", sourceIntersectionId: "1537", pedestrianSignalGroupId: "tdata:1537:ntPdsg" }, thuNoon, "seoul-newyear").plan?.sourcePlanId,
    ).toBe("HOLI");
    expect(
      selectOperatingPlan([holiday], { source: "field", sourceIntersectionId: "1537", pedestrianSignalGroupId: "tdata:1537:ntPdsg" }, thuNoon).reason,
    ).toBe("no_plan_for_clock");
  });
});

describe("MAE tool", () => {
  it("keeps unpredictable rows out of MAE and does not coerce them to 0", () => {
    const rows: FieldObservation[] = [
      {
        synthetic: false,
        crossingInternalId: "field:N-entry",
        sourceIntersectionId: "1537",
        dateSeoul: "2026-09-10",
        timeBand: "noon",
        specialDayId: "",
        deviceClockErrorSec: 0,
        greenStartMs: epoch + 10000,
        flashStartMs: null,
        redStartMs: null,
        arrivedEntryMs: epoch,
        predictedWaitSec: 8,
        observedWaitSec: 10,
        sourceResponseAtMs: epoch,
        exceptionOperation: false,
        notes: "",
      },
      {
        synthetic: false,
        crossingInternalId: "field:N-entry",
        sourceIntersectionId: "1537",
        dateSeoul: "2026-09-10",
        timeBand: "noon",
        specialDayId: "",
        deviceClockErrorSec: 0,
        greenStartMs: null,
        flashStartMs: null,
        redStartMs: null,
        arrivedEntryMs: epoch,
        predictedWaitSec: null,
        observedWaitSec: 4,
        sourceResponseAtMs: null,
        exceptionOperation: false,
        notes: "",
      },
      {
        synthetic: true,
        crossingInternalId: "synthetic:x",
        sourceIntersectionId: "x",
        dateSeoul: "2026-09-10",
        timeBand: "",
        specialDayId: "",
        deviceClockErrorSec: 0,
        greenStartMs: null,
        flashStartMs: null,
        redStartMs: null,
        arrivedEntryMs: null,
        predictedWaitSec: 0,
        observedWaitSec: 0,
        sourceResponseAtMs: null,
        exceptionOperation: false,
        notes: "",
      },
    ];
    const report = evaluateObservations(rows);
    expect(report.wait.n).toBe(1);
    expect(report.wait.mae).toBe(2);
    expect(report.unpredictable).toBe(1);
    expect(report.accuracyClaim).toBe("unverified");
  });
});

describe("collect classify", () => {
  it("separates html, empty, auth, and json", () => {
    const html = classifyCollected(200, "text/html", new TextEncoder().encode("<html>login</html>"));
    expect(html.kind).toBe("html");
    const empty = classifyCollected(200, "application/json", new Uint8Array());
    expect(empty.kind).toBe("empty");
    const auth = classifyCollected(403, "application/json", new TextEncoder().encode("{}"));
    expect(auth.kind).toBe("auth");
    const utic = classifyCollected(
      200,
      "application/json",
      new TextEncoder().encode(JSON.stringify([{ resultCode: "30", resultMsg: "denied" }])),
    );
    expect(utic.kind).toBe("auth");
  });
});

describe("tdata remaining unit", () => {
  it("does not convert RmdrCs while the catalog unit conflict is unresolved", () => {
    expect(remainingRawCs("817").seconds).toBeNull();
    expect(remainingRawCs("").raw).toBeNull();
    expect(remainingRawCs(0).raw).toBe(0);
  });
  it("reads pedestrian status and keeps remaining as raw", () => {
    const view = interpretCurrentState(
      {
        itstId: "42",
        trsmUtcTime: 1_800_000_000_000,
        ntPdsgStatNm: "녹색",
        etPdsgStatNm: "",
        ntStsgStatNm: "적색",
        ntPdsgRmdrCs: "817",
      },
      1_800_000_030_000,
      "timing",
    );
    expect(view.itstId).toBe("42");
    expect(view.pedestrian).toEqual([
      { key: "ntPdsgStatNm", direction: "북쪽", kind: "pedestrian", statusName: "녹색" },
    ]);
    expect(view.remainingPedestrian[0]?.raw).toBe(817);
    expect(view.remainingPedestrian[0]?.seconds).toBeNull();
    expect(view.stale).toBe(false);
  });
  it("marks delayed current state without inventing a cycle", () => {
    const view = interpretCurrentState(
      { itstId: "42", trsmUtcTime: 1, ntPdsgStatNm: "적색" },
      120_000,
      "phase",
    );
    expect(view.stale).toBe(true);
    expect(view.notes.some((n) => n.includes("지연"))).toBe(true);
  });
});

describe("recommend copy", () => {
  it("does not call unknown coverage a signal-free path", () => {
    expect(coverageCopy("unknown")).toMatch(/확인되지 않았/);
    expect(coverageCopy("unknown")).not.toMatch(/없는 경로/);
    const lines = recommendSentences({
      reason: "walking-baseline",
      coverage: "unknown",
      liveSignals: false,
      extraM: 40,
      sharpTurns: 1,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/신호 데이터가 확인되지 않아/);
  });

  it("explains signal-based routing with baseline distance and saved wait", () => {
    const lines = recommendSentences({
      reason: "signal-compare",
      coverage: "complete",
      liveSignals: true,
      extraM: 70,
      sharpTurns: 0,
      waitSavedSec: 42,
    });
    expect(lines[0]).toBe(
      "기본 경로보다 70m 길지만 예상 신호 대기가 약 42초 적습니다.",
    );
  });
});

describe("verified provider wiring", () => {
  it("places crossings on the polyline and strips plans until a survey+scope exists", async () => {
    const crossing = validateCrossing(crossingRow).ok as CrossingRecord;
    const plan = validatePlan(planRow).ok as OperatingPlanRecord;
    const path = routeAt("tmap-0", [
      [126.9779, 37.5664],
      [126.9783, 37.5668],
    ]);
    const hits = crossingsAlongRoute(path, [crossing], 80);
    expect(hits.length).toBeGreaterThan(0);
    const provider = createVerifiedProvider(
      { version: 1, synthetic: false, crossings: [crossing], plans: [plan], surveys: [] },
      parsePredictionScopes("field:1537"),
      () => epoch,
    );
    const unseen = await provider.inspect(path, epoch);
    expect(unseen.completeCoverage).toBe(false);
    expect(unseen.crossings[0]?.plan).toBeNull();
    const surveyed = createVerifiedProvider(
      {
        version: 1,
        synthetic: false,
        crossings: [crossing],
        plans: [plan],
        surveys: [
          {
            id: "s1",
            complete: true,
            coordinates: path.coordinates,
            crossingInternalIds: [crossing.internalId],
          },
        ],
      },
      parsePredictionScopes("field:1537"),
      () => epoch,
    );
    const ready = await surveyed.inspect(path, epoch);
    expect(ready.completeCoverage).toBe(true);
    const runtime = toRuntimeCrossing(crossing, plan, epoch, ready.crossings[0].atM);
    expect(runtime?.plan).not.toBeNull();
    expect(
      forecast(path.distanceM, 360, epoch, ready.crossings, true, epoch).waitSec,
    ).not.toBeNull();
  });

  it("reports verified-only eligibility and explicit excluded reasons", () => {
    const crossing = validateCrossing(crossingRow).ok as CrossingRecord;
    const plan = validatePlan(planRow).ok as OperatingPlanRecord;
    const base = {
      version: 1 as const,
      synthetic: false as const,
      crossings: [crossing],
      plans: [plan],
      surveys: [],
    };
    const inactive = auditVerifiedBundle(base, [], epoch);
    expect(inactive.predictionReady).toBe(false);
    expect(inactive.crossingsTotal).toBe(1);
    expect(inactive.directionMapped).toBe(1);
    expect(inactive.epochKnown).toBe(1);
    expect(inactive.widthKnown).toBe(1);
    expect(inactive.predictionEligible).toBe(0);
    expect(inactive.excludedReasons.scope_inactive).toBe(1);
    expect(inactive.excludedReasons.survey_incomplete).toBe(1);

    const eligible = auditVerifiedBundle(
      {
        ...base,
        surveys: [
          {
            id: "s1",
            complete: true,
            coordinates: [
              [126.9779, 37.5664],
              [126.9783, 37.5668],
            ],
            crossingInternalIds: [crossing.internalId],
          },
        ],
      },
      parsePredictionScopes("field:1537"),
      epoch,
    );
    expect(eligible.predictionEligible).toBe(1);
    expect(eligible.predictionExcluded).toBe(0);
  });

  it("loads the verified pilot corridor with evidence and route survey coverage", async () => {
    const raw = JSON.parse(
      readFileSync(
        new URL("../../../data/signals/verified/bundle.json", import.meta.url),
        "utf8",
      ),
    );
    const bundle = parseVerifiedBundle(raw);
    expect(bundle.synthetic).toBe(false);
    expect(bundle.crossings.length).toBe(2);
    expect(bundle.plans.length).toBe(2);
    expect(bundle.crossings.every((c) => c.evidence.length > 0)).toBe(true);
    expect(bundle.plans.every((p) => p.evidence.length > 0)).toBe(true);
    expect(
      bundle.crossings.every(
        (c) =>
          c.metadata?.sourceDocument &&
          c.metadata.verifiedAt &&
          c.metadata.verificationMethod,
      ),
    ).toBe(true);
    expect(bundle.surveys[0]?.complete).toBe(true);
    expect(bundle.surveys[0]?.expectedCrossingInternalIds).toEqual([
      "field:pilot-corridor-a-eastbound",
      "field:pilot-corridor-b-eastbound",
    ]);

    const route = routeAt("pilot", bundle.surveys[0].coordinates);
    route.distanceM = 1000;
    const provider = createVerifiedProvider(
      bundle,
      parsePredictionScopes("field:pilot-corridor-20260917"),
      () => pilotDeparture,
    );
    const inspected = await provider.inspect(route, pilotDeparture);
    expect(inspected.completeCoverage).toBe(true);
    expect(inspected.crossings.map((c) => c.id)).toEqual([
      "field:pilot-corridor-a-eastbound",
      "field:pilot-corridor-b-eastbound",
    ]);
    expect(inspected.crossings.every((c) => c.plan !== null)).toBe(true);
  });
});

describe("pilot forecast arithmetic", () => {
  it("calculates arrival phase and wait at the first pilot crossing", () => {
    const crossing: Crossing = {
      id: "a",
      name: "pilot A",
      atM: 500,
      widthM: 22,
      plan: fixedPlan(),
    };
    const result = forecast(1000, 360, pilotDeparture, [crossing], true, pilotDeparture);
    expect(result.crossings[0]?.arrivalMs).toBe(pilotDeparture + 180_000);
    expect(result.crossings[0]?.waitSec).toBe(30);
    expect(result.waitSec).toBe(30);
    expect(result.stops).toBe(1);
  });

  it("applies crossing width, walking speed, and buffer when latest entry is calculated", () => {
    const crossSec = 22 / CROSSING_WALK_M_PER_SEC + CROSSING_BUFFER_SEC;
    const latestEntry = Math.min(55, 60 - crossSec);
    expect(crossSec).toBeCloseTo(21.333, 3);
    expect(latestEntry).toBeCloseTo(38.667, 3);
    const lateArrival: Crossing = {
      id: "late",
      name: "late",
      atM: 625,
      widthM: 22,
      plan: fixedPlan(),
    };
    const result = forecast(
      1000,
      360,
      pilotDeparture,
      [lateArrival],
      true,
      pilotDeparture,
    );
    expect(result.crossings[0]?.arrivalMs).toBe(pilotDeparture + 225_000);
    expect(result.crossings[0]?.waitSec).toBe(45);
  });

  it("pushes later crossing ETA by the wait at earlier signals", () => {
    const crossings: Crossing[] = [
      {
        id: "a",
        name: "pilot A",
        atM: 500,
        widthM: 22,
        plan: fixedPlan(),
      },
      {
        id: "b",
        name: "pilot B",
        atM: 900,
        widthM: 12,
        plan: fixedPlan({ entryStartSec: 0, entryEndSec: 50 }),
      },
    ];
    const result = forecast(1000, 360, pilotDeparture, crossings, true, pilotDeparture);
    expect(result.crossings[0]?.waitSec).toBe(30);
    expect(result.crossings[1]?.arrivalMs).toBe(pilotDeparture + 354_000);
    expect(result.crossings[1]?.waitSec).toBe(6);
    expect(result.waitSec).toBe(36);
    expect(result.maxWaitSec).toBe(30);
    expect(result.stops).toBe(2);
  });
});
