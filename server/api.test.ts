import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleApi, parseTmap, resetApiRuntimeForTests } from "./api.ts";
import type { Crossing, FixedPlan } from "../src/real/core.ts";
const origin = { id: "a", name: "출발", coord: [127, 37] },
  destination = { id: "b", name: "도착", coord: [127, 37.01] };
const body = {
  origin,
  destination,
  waypoints: [{ ...origin, coord: [127, 37.005] }],
  pace: 360,
};
const routeData = {
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [127, 37] },
      properties: { totalDistance: 1100, totalTime: 999, description: "출발" },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [127, 37],
          [127, 37.01],
        ],
      },
      properties: {},
    },
  ],
};
const request = (extra?: Record<string, unknown>) =>
  new Request("https://app.test/api/routes", {
    method: "POST",
    body: JSON.stringify({ ...body, ...extra }),
  });
beforeEach(() => resetApiRuntimeForTests());
describe("server provider boundary", () => {
  it("reports configuration without exposing credentials or claiming verification", async () => {
    const r = await handleApi(new Request("https://app.test/api/status"), {
      TMAP_APP_KEY: "private-example",
    });
    const s = await r.text();
    expect(s).not.toContain("private-example");
    const status = JSON.parse(s);
    expect(status.signalPrediction).toBe(false);
    expect(status.signal.configured.seoul).toBe(false);
    expect(status.signal.reachable.seoul).toBeNull();
    expect(status.signal.mappingReady).toBe(false);
    expect(status.signal.predictionReady).toBe(false);
    expect(status.signal.predictionByRegion["서울"]).toBe(false);
  });
  it("fails with actionable status for missing keys without network calls", async () => {
    const f = vi.fn();
    expect((await handleApi(request(), {}, f)).status).toBe(503);
    expect(f).not.toHaveBeenCalled();
  });
  it("retains required waypoints and uses documented routing options with a server header", async () => {
    const f = vi.fn(async () => Response.json(routeData));
    const response = await handleApi(
      request(),
      { TMAP_APP_KEY: "test-key" },
      f,
    );
    expect(response.status).toBe(200);
    const calls = f.mock.calls;
    expect(calls).toHaveLength(3);
    for (const [, init] of calls) {
      const sent = JSON.parse(init.body);
      expect(sent.passList).toBe("127,37.005");
      expect(sent.reqCoordType).toBe("WGS84GEO");
      expect(init.headers.appKey).toBe("test-key");
    }
    expect(calls.map((c) => JSON.parse(c[1].body).searchOption)).toEqual([
      "4",
      "30",
      "0",
    ]);
    const result = await response.json();
    expect(result.routes.some((r: { id: string }) => r.id === result.recommendedId)).toBe(
      true,
    );
    expect(result.forecasts[result.recommendedId].waitSec).toBeNull();
    expect(result.recommendationReason).toBe("walking-baseline");
  });
  it("keeps partial successful route responses available", async () => {
    let count = 0;
    const f = vi.fn(async () =>
      ++count === 1
        ? new Response("", { status: 500 })
        : Response.json(routeData),
    );
    const r = await handleApi(request(), { TMAP_APP_KEY: "key" }, f);
    expect((await r.json()).partial).toBe(true);
  });
  it("does not leak upstream error bodies", async () => {
    const f = vi.fn(
      async () => new Response("secret-test-key", { status: 401 }),
    );
    const r = await handleApi(
      request(),
      { TMAP_APP_KEY: "secret-test-key" },
      f,
    );
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain("secret-test-key");
  });
  it("rejects invalid coordinates and pace before contacting providers", async () => {
    const f = vi.fn();
    const r = await handleApi(
      new Request("https://app.test/api/routes", {
        method: "POST",
        body: JSON.stringify({ ...body, pace: 0 }),
      }),
      {},
      f,
    );
    expect(r.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it("rejects unknown signal services rather than becoming an arbitrary proxy", async () => {
    const f = vi.fn();
    const r = await handleApi(
      new Request(
        "https://app.test/api/signals/seoul?itstId=123&service=https://evil.test",
      ),
      { SEOUL_TDATA_API_KEY: "key" },
      f,
    );
    expect(r.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it("uses apiKey capitalization and labels current state as non-predictive", async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json([{ itstId: "123" }]),
    );
    const r = await handleApi(
      new Request("https://app.test/api/signals/seoul?itstId=123"),
      { SEOUL_TDATA_API_KEY: "test" },
      f,
    );
    expect(
      new URL(f.mock.calls[0][0] as string).searchParams.get("apiKey"),
    ).toBe("test");
    expect((await r.json()).predictionReady).toBe(false);
  });
  it("requires a Kakao REST key; does not use a JavaScript key", async () => {
    const f = vi.fn();
    const r = await handleApi(
      new Request("https://app.test/api/places?q=서울숲"),
      { KAKAO_JAVASCRIPT_KEY: "test" },
      f,
    );
    expect(r.status).toBe(503);
    expect(f).not.toHaveBeenCalled();
  });
  it("reverse-geocodes with REST header and documented WGS84 params", async () => {
    const f = vi.fn(async () =>
      Response.json({
        documents: [
          {
            road_address: {
              address_name: "서울 성동구 서울숲길 1",
              building_name: "서울숲",
            },
            address: { address_name: "서울 성동구 성수동" },
          },
        ],
      }),
    );
    const r = await handleApi(
      new Request("https://app.test/api/places/reverse?x=127.037&y=37.544"),
      { KAKAO_REST_API_KEY: "rest-key" },
      f,
    );
    expect(r.status).toBe(200);
    const called = new URL(f.mock.calls[0][0] as string);
    expect(called.pathname).toContain("coord2address");
    expect(called.searchParams.get("input_coord")).toBe("WGS84");
    expect(f.mock.calls[0][1]?.headers.Authorization).toBe("KakaoAK rest-key");
    expect((await r.json()).place.name).toBe("서울숲");
  });
  it("uses route distance from the provider, not provider walking time as running time", () => {
    const route = parseTmap(routeData, "4");
    expect(route.distanceM).toBe(1100);
    expect((route.distanceM / 1000) * 360).toBeCloseTo(396);
    expect(route.straightM).toBeGreaterThan(0);
    expect(route.nearbyPois).toEqual([]);
  });
  it("keeps TMAP 횡단 instructions on the route without turning them into waits", () => {
    const route = parseTmap(
      {
        features: [
          ...routeData.features,
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [127, 37.005] },
            properties: { description: "횡단보도를 건너세요" },
          },
        ],
      },
      "0",
    );
    expect(route.nearbyPois?.map((p) => p.source)).toEqual([
      "tmap-instruction",
    ]);
  });
  it("does not guess a crossroad Open API that the catalog lists as a file", async () => {
    const f = vi.fn();
    const r = await handleApi(
      new Request("https://app.test/api/signals/seoul?itstId=1537&service=crossroad"),
      { SEOUL_TDATA_API_KEY: "key" },
      f,
    );
    expect(r.status).toBe(503);
    expect(f).not.toHaveBeenCalled();
    expect(await r.text()).toMatch(/10144/);
  });
  it("requires a documented UTIC op and does not fetch files or unknown ops", async () => {
    const f = vi.fn();
    const bare = await handleApi(
      new Request("https://app.test/api/signals/utic"),
      { UTIC_SERVICE_KEY: "k" },
      f,
    );
    expect(bare.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
    const fileOp = await handleApi(
      new Request("https://app.test/api/signals/utic?op=crossInfo&srchCTId=L01"),
      { UTIC_SERVICE_KEY: "k" },
      f,
    );
    expect(fileOp.status).toBe(503);
    expect(f).not.toHaveBeenCalled();
  });
  it("proxies documented UTIC plan queries without enabling prediction", async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      expect(u.pathname).toContain("/PlanCrossRoadInfoService/getPlanCROPInfo");
      expect(u.searchParams.get("srchCTId")).toBe("L01");
      return Response.json({
        PlanCROPInfo: {
          REGION_CD: "L01",
          INT_NO: "1",
          INT_PLAN_NO: "1",
          OPER_PLAN_HH: "6",
          OPER_PLAN_MI: "0",
          INT_OPER_CYCLE_VAL: "180",
          A_RING_1_PHASE_VAL: "180",
        },
      });
    });
    const r = await handleApi(
      new Request(
        "https://app.test/api/signals/utic?op=getPlanCROPInfo&srchCTId=L01",
      ),
      { UTIC_SERVICE_KEY: "k" },
      f,
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.predictionReady).toBe(false);
    expect(body.engineReady).toBe(false);
    expect(body.parsed[0].cycleSec).toBe(180);
    expect(body.parsed[0].engineReady).toBe(false);
  });
});

describe("future signal adapter contract", () => {
  it("isolates a failed signal provider from successful walking routes", async () => {
    const f = vi.fn(async () => Response.json(routeData));
    const r = await handleApi(request(), { TMAP_APP_KEY: "test-key" }, f, {
      inspect: async () => {
        throw new Error("offline");
      },
    });
    const result = await r.json();
    expect(r.status).toBe(200);
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.routes.some((row: { id: string }) => row.id === result.recommendedId)).toBe(
      true,
    );
    expect(result.forecasts[result.recommendedId].waitSec).toBeNull();
    expect(result.recommendationReason).toBe("walking-baseline");
  });
});

function tmapPayload(distanceM: number, coords: number[][]) {
  return {
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: coords[0] },
        properties: { totalDistance: distanceM, totalTime: 999, description: "출발" },
      },
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: {},
      },
    ],
  };
}

function tmapForOption(init?: RequestInit) {
  const option = JSON.parse(String(init?.body)).searchOption;
  if (option === "4")
    return Response.json(
      tmapPayload(1180, [
        [127, 37],
        [127.008, 37],
        [127.008, 37.004],
        [127.002, 37.004],
        [127.002, 37.01],
      ]),
    );
  if (option === "30")
    return Response.json(
      tmapPayload(1120, [
        [127, 37],
        [127, 37.01],
      ]),
    );
  return Response.json(
    tmapPayload(1130, [
      [127, 37],
      [127.0008, 37.01],
    ]),
  );
}

describe("route recommendation contract", () => {
  it("does not use the first TMAP option as the walking baseline", async () => {
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      tmapForOption(init),
    );
    const r = await handleApi(request(), { TMAP_APP_KEY: "key" }, f);
    const result = await r.json();
    expect(result.routes.length).toBeGreaterThan(1);
    expect(result.recommendedId).not.toBe("tmap-4");
    expect(result.routes[0].id).toBe(result.recommendedId);
    expect(result.routes.map((row: { id: string }) => row.id)).toContain(
      result.recommendedId,
    );
  });
  it("returns stairs empty when the stairs-free option fails", async () => {
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const option = JSON.parse(String(init?.body)).searchOption;
      if (option === "30") return new Response("", { status: 500 });
      return tmapForOption(init);
    });
    const r = await handleApi(
      request({ policy: { avoidStairs: true } }),
      { TMAP_APP_KEY: "key" },
      f,
    );
    expect(r.status).toBe(404);
    expect((await r.json()).error).toMatch(/계단 제외/);
  });
  it("returns a recommendedId that survives the same policy the screen would apply", async () => {
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      tmapForOption(init),
    );
    const r = await handleApi(
      request({
        policy: {
          detourRatio: 0.1,
          detourMaxM: 300,
          avoidStairs: true,
          avoidOverpass: false,
          avoidAlley: false,
        },
      }),
      { TMAP_APP_KEY: "key" },
      f,
    );
    const result = await r.json();
    expect(result.routes.every((row: { option: string }) => row.option === "30")).toBe(
      true,
    );
    expect(result.recommendedId).toBe("tmap-30");
    expect(result.policyApplied.detourMaxM).toBe(300);
  });
  it("keeps walking recommendation when coverage is unverified", async () => {
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      tmapForOption(init),
    );
    const r = await handleApi(request(), { TMAP_APP_KEY: "key" }, f, {
      inspect: async () => ({
        completeCoverage: false,
        crossings: [],
        source: "test-unverified",
      }),
    });
    const result = await r.json();
    expect(result.signalCoverage).toBe("unknown");
    expect(result.forecasts[result.recommendedId].waitSec).toBeNull();
    expect(result.recommendationReason).toBe("walking-baseline");
  });
  it("distinguishes a verified zero wait from missing information", async () => {
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      tmapForOption(init),
    );
    const r = await handleApi(request(), { TMAP_APP_KEY: "key" }, f, {
      inspect: async () => ({
        completeCoverage: true,
        crossings: [],
        source: "test-fixture",
      }),
    });
    const result = await r.json();
    expect(result.forecasts[result.recommendedId].waitSec).toBe(0);
    expect(result.forecasts[result.recommendedId].stops).toBe(0);
    expect(result.signalCoverage).toBe("complete");
  });
  it("can prefer a lower-wait candidate without dropping the recommended id", async () => {
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      tmapForOption(init),
    );
    const r = await handleApi(request(), { TMAP_APP_KEY: "key" }, f, {
      inspect: async (route) => {
        const now = Date.now();
        const plan: FixedPlan = {
          cycleSec: 60,
          epochMs: now,
          entryStartSec: 0,
          entryEndSec: 20,
          clearEndSec: 30,
          validFromMs: now - 1000,
          validToMs: now + 3_600_000,
          verifiedAtMs: now,
          uncertaintySec: 0,
        };
        const crossing: Crossing = {
          id: "a",
          name: "a",
          atM: 100,
          widthM: 10,
          plan,
        };
        return {
          completeCoverage: true,
          crossings: route.id === "tmap-30" ? [crossing] : [],
          source: "test-fixture",
        };
      },
    });
    const result = await r.json();
    expect(result.routes.map((row: { id: string }) => row.id)).toContain(
      result.recommendedId,
    );
    expect(result.forecasts[result.recommendedId].waitSec).not.toBeNull();
    expect(result.recommendationReason).toBe("signal-compare");
    expect(result.recommendedId).not.toBe("tmap-30");
  });
  it("marks Seoul reachable after a successful probe without enabling prediction", async () => {
    const f = vi.fn(async () => Response.json([{ itstId: "123" }]));
    const probe = await handleApi(
      new Request("https://app.test/api/signals/seoul?itstId=123"),
      { SEOUL_TDATA_API_KEY: "test" },
      f,
    );
    expect(probe.status).toBe(200);
    expect((await probe.json()).predictionReady).toBe(false);
    const status = await (
      await handleApi(new Request("https://app.test/api/status"), {
        SEOUL_TDATA_API_KEY: "test",
      })
    ).json();
    expect(status.signal.configured.seoul).toBe(true);
    expect(status.signal.reachable.seoul).toBe(true);
    expect(status.signal.mappingReady).toBe(false);
    expect(status.signal.predictionReady).toBe(false);
    expect(status.signalPrediction).toBe(false);
  });
});
