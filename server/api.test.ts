import { describe, expect, it, vi } from "vitest";
import { handleApi, parseTmap } from "./api.ts";
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
const request = () =>
  new Request("https://app.test/api/routes", {
    method: "POST",
    body: JSON.stringify(body),
  });
describe("server provider boundary", () => {
  it("reports configuration without exposing credentials or claiming verification", async () => {
    const r = await handleApi(new Request("https://app.test/api/status"), {
      TMAP_APP_KEY: "private-example",
    });
    const s = await r.text();
    expect(s).not.toContain("private-example");
    expect(JSON.parse(s).signalPrediction).toBe(false);
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
  it("uses route distance from the provider, not provider walking time as running time", () => {
    const route = parseTmap(routeData, "4");
    expect(route.distanceM).toBe(1100);
    expect((route.distanceM / 1000) * 360).toBeCloseTo(396);
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
    expect(result.routes.length).toBe(3);
    expect(result.forecasts["tmap-4"].waitSec).toBeNull();
  });
});
