import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmSeoulPlan, createSeoulLiveProvider } from "./seoul-live-provider.ts";
import { handleApi } from "./api.ts";
import type { Route } from "../src/real/core.ts";
import type { OperatingPlanRecord } from "../src/real/signals/schema.ts";
import type { TdataPedestrianMapping, VerifiedBundle } from "../src/real/signals/provider.ts";

// Synthetic response fixtures exercise verified-data gates; never deploy these.
const now = Date.parse("2026-10-11T12:00:00+09:00");
const mapping: TdataPedestrianMapping = {
  crossingInternalId: "tdata:test-north", direction: "nt", remainingUnit: "deciseconds",
  verifiedAtMs: now - 60_000, evidence: "Synthetic test: field-verified direction and unit gate",
};
const plan: OperatingPlanRecord = {
  stage: "verified", synthetic: false, source: "tdata", sourcePlanId: "test-plan", version: "1",
  sourceIntersectionId: "1850", pedestrianSignalGroupId: "tdata:1850:ntPdsg",
  cycleSec: 90, epochMs: now - 20_000, entryStartSec: 0, entryEndSec: 40,
  flashStartSec: 40, clearEndSec: 60,
  validFromMs: now - 3_600_000, validToMs: now + 3_600_000,
  apply: { timeZone: "Asia/Seoul", weekdays: [], startHm: "00:00", endHm: "24:00", specialDayIds: [], appliesOnUnlistedSpecialDay: false },
  uncertaintySec: 1, operationMode: "fixed", evidence: [], planVerifiedAt: now - 60_000,
  observedAt: null, fetchedAt: null, currentPlanConfirmedAt: null,
};
const response = (extra: Record<string, unknown> = {}) => [{
  itstId: "1850", trsmUtcTime: now, ntPdsgStatNm: "protected-Movement-Allowed", ntPdsgRmdrCs: 200, ...extra,
}];
const route: Route = {
  id: "seoul", name: "서울 테스트", coordinates: [[127.03, 37.51], [127.03, 37.516]],
  distanceM: 667.2, sharpTurns: 0, zigzags: 0, option: "4", instructions: [],
};
const bundle: VerifiedBundle = {
  version: 1, synthetic: false, plans: [plan], liveMappings: [mapping],
  crossings: [{
    stage: "verified", synthetic: false, source: "tdata", sourceCrossingId: "test-north",
    sourceIntersectionId: "1850", internalId: mapping.crossingInternalId,
    entryCoord: [127.03, 37.512], exitCoord: [127.03, 37.5121],
    travel: { bearingDeg: 0, label: "북쪽", evidence: "Synthetic direction gate" },
    pedestrianSignalGroupId: plan.pedestrianSignalGroupId, crossingLengthM: 12, paintedWidthM: 4,
    geometryType: "crossing-endpoints", hasRefugeIsland: false, stageIndex: 1, stageCount: 1,
    evidence: [], planVerifiedAt: now - 60_000, observedAt: null, fetchedAt: null, currentPlanConfirmedAt: null,
  }],
  surveys: [{ id: "test-survey", complete: true, coordinates: route.coordinates, crossingInternalIds: [mapping.crossingInternalId] }],
};
afterEach(() => vi.useRealTimers());
describe("Seoul live fixed-plan confirmation", () => {
  it("confirms a documented plan using the source clock, state and verified unit", () => {
    const result = confirmSeoulPlan(plan, mapping, response(), now + 1000);
    expect(result?.currentPlanConfirmedAt).toBe(now);
    expect(result?.fetchedAt).toBe(now + 1000);
    expect(plan.currentPlanConfirmedAt).toBeNull();
  });
  it.each([
    { trsmUtcTime: now - 11_000 }, { trsmUtcTime: now + 2000 },
    { itstId: "9999" }, { ntPdsgRmdrCs: null }, { ntPdsgRmdrCs: 800 },
    { ntPdsgStatNm: "stop-And-Remain" }, { ntPdsgStatNm: "protected-Clearance" },
  ])("refuses stale, mismatched or incomplete current state", (extra) => {
    expect(confirmSeoulPlan(plan, mapping, response(extra), now)).toBeNull();
  });
  it("does not turn an unverified or actuated plan into a fixed cycle", () => {
    expect(confirmSeoulPlan({ ...plan, operationMode: "actuated" }, mapping, response(), now)).toBeNull();
    expect(confirmSeoulPlan({ ...plan, planVerifiedAt: null }, mapping, response(), now)).toBeNull();
    expect(confirmSeoulPlan(plan, { ...mapping, remainingUnit: "centiseconds" }, response(), now)).toBeNull();
  });
  it("only interprets red as time until green when that relationship is verified", () => {
    const redPlan = { ...plan, epochMs: now - 70_000 };
    const red = response({ ntPdsgStatNm: "stop-And-Remain", ntPdsgRmdrCs: 200 });
    expect(confirmSeoulPlan(redPlan, mapping, red, now)).toBeNull();
    expect(confirmSeoulPlan(redPlan, { ...mapping, redEndsAtEntryStart: true }, red, now)).not.toBeNull();
  });
  it("shares an intersection fetch and exposes only confirmed direction-matched plans", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json(response()));
    const provider = createSeoulLiveProvider(bundle, [{ source: "tdata", sourceIntersectionId: "1850" }], "test-key", fetcher, () => now);
    const [a, b] = await Promise.all([provider.inspect(route, now), provider.inspect({ ...route, id: "other" }, now)]);
    expect(a.completeCoverage).toBe(true);
    expect(a.crossings[0].plan?.verifiedAtMs).toBe(now);
    expect(b.crossings[0].plan).not.toBeNull();
    expect(a.crossings[0].atM).toBeCloseTo(route.distanceM / 3, 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toContain("v2xSignalPhaseTimingFusionCurrentInfo");
    expect(url.searchParams.get("apikey")).toBe("test-key");
    expect(url.searchParams.has("apiKey")).toBe(false);
  });
  it("recovers a stale plan through the API only when live confirmation succeeds", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const env = { SIGNAL_PUBLIC_PREDICTION: "true", SIGNAL_PREDICTION_SCOPES: "tdata:1850",
      SIGNAL_VERIFIED_JSON: JSON.stringify(bundle), SEOUL_TDATA_API_KEY: "test-key" };
    const request = () => new Request("https://app.test/api/routes/evaluate", { method: "POST",
      body: JSON.stringify({ pace: 360, candidates: [{ route }] }) });
    const status = await (await handleApi(new Request("https://app.test/api/status"), env, vi.fn())).json();
    expect(status.signal.predictionReady).toBe(false);
    expect(status.signal.liveFeedConfigured).toBe(true);
    const result = await (await handleApi(request(), env, vi.fn(async () => Response.json(response())))).json();
    expect(result.forecasts.seoul.waitSec).not.toBeNull();
    const failed = await (await handleApi(request(), env, vi.fn(async () => Response.json(response({ trsmUtcTime: now - 11_000 }))))).json();
    expect(failed.forecasts.seoul.waitSec).toBeNull();
  });
  it("forecasts one verified live interval without a fixed cycle or epoch", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const liveBundle = { ...bundle, plans: [], liveMappings: [{ ...mapping,
      redEndsAtEntryStart: true, minimumGreenSec: 40 }] };
    const env = { SIGNAL_PUBLIC_PREDICTION: "true", SIGNAL_PREDICTION_SCOPES: "tdata:1850",
      SIGNAL_VERIFIED_JSON: JSON.stringify(liveBundle), SEOUL_TDATA_API_KEY: "test-key" };
    const fetcher = vi.fn(async () => Response.json(response({ ntPdsgStatNm: "stop-And-Remain", ntPdsgRmdrCs: 1000 })));
    const status = await (await handleApi(new Request("https://app.test/api/status"), env, fetcher)).json();
    expect(status.signal).toMatchObject({ planReady: false, predictionReady: false, liveFeedConfigured: true });
    const request = new Request("https://app.test/api/routes/evaluate", { method: "POST",
      body: JSON.stringify({ pace: 360, candidates: [{ route }] }) });
    const result = await (await handleApi(request, env, fetcher)).json();
    expect(result.forecasts.seoul.crossings[0].plan).toBeNull();
    expect(result.forecasts.seoul.crossings[0].liveWindow.state).toBe("red");
    expect(result.forecasts.seoul.waitSec).toBeGreaterThan(0);
    expect(result.forecasts.seoul.validUntilMs).toBe(now + 10_000);
    expect(result.refreshAfterMs).toBe(5000);
  });
  it("returns unknown waits and tells the running client when the quota resets", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const env = { SIGNAL_PUBLIC_PREDICTION: "true", SIGNAL_PREDICTION_SCOPES: "tdata:1850",
      SIGNAL_VERIFIED_JSON: JSON.stringify(bundle), SEOUL_TDATA_API_KEY: "test-key" };
    const request = () => new Request("https://app.test/api/routes/evaluate", { method: "POST",
      body: JSON.stringify({ pace: 360, candidates: [{ route }] }) });
    const fetcher = vi.fn(async () => Response.json({ responseCode: 429 }, { status: 429, headers: { "Retry-After": "120" } }));
    const result = await (await handleApi(request(), env, fetcher)).json();
    expect(result.forecasts.seoul.waitSec).toBeNull();
    expect(result.refreshAfterMs).toBe(120_000);
    await handleApi(request(), env, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not request passed crossings or live windows beyond the reachable horizon", async () => {
    const fetcher = vi.fn(async () => Response.json(response()));
    const provider = createSeoulLiveProvider({ ...bundle, plans: [] },
      [{ source: "tdata", sourceIntersectionId: "1850" }], "test-key", fetcher, () => now);
    await provider.inspect(route, now, { paceSecPerKm: 360, traveledM: 300 });
    await provider.inspect(route, now, { paceSecPerKm: 1800, traveledM: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
