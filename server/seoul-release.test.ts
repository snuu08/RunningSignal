import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleApi, resetApiRuntimeForTests } from "./api.ts";
import { RELEASE_ID } from "./release.ts";

const key = "test-secret+reserved&chars";
const probe = () => new Request("https://app.test/api/signals/seoul?service=current&itstId=20386");
const env = { SEOUL_TDATA_API_KEY: key };
beforeEach(resetApiRuntimeForTests);
describe("Seoul deployment contract", () => {
  it("exposes the deployed version and current service without probing upstream", async () => {
    const fetcher = vi.fn();
    const response = await handleApi(new Request("https://app.test/api/status"), env, fetcher);
    expect((await response.json()).release).toMatchObject({ id: RELEASE_ID, seoulServices: expect.arrayContaining(["current"]) });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the current API, returns real source time, and redacts echoed credentials", async () => {
    const now = Date.now();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toContain("v2xSignalPhaseTimingFusionCurrentInfo");
      expect(url.searchParams.get("apikey")).toBe(key);
      return Response.json([{ itstId: "20386", trsmUtcTime: now,
        ntPdsgStatNm: "stop-And-Remain", ntPdsgRmdrCs: 250,
        debug: `apikey=${encodeURIComponent(key)}`, apiKey: key }]);
    });
    const response = await handleApi(probe(), env, fetcher);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(key);
    expect(text).not.toContain(encodeURIComponent(key));
    expect(JSON.parse(text)).toMatchObject({ resultClass: "ok-data", predictionReady: false,
      current: { itstId: "20386", sourceTimestampMs: now, pedestrianPresent: true, remainingPresent: true } });
  });
  it.each([
    { body: { errorType: "InvalidApiKey" }, http: 200, expected: 503 },
    { body: { error: "API_KEY_EXPIRED" }, http: 200, expected: 503 },
    { body: { error: "unauthorized" }, http: 403, expected: 503 },
    { body: { error: "limit" }, http: 429, expected: 429 },
  ])("does not report an upstream error as a successful signal ($http/$expected)", async ({ body, http, expected }) => {
    const response = await handleApi(probe(), env, async () => Response.json(body, { status: http }));
    expect(response.status).toBe(expected);
    const status = await (await handleApi(new Request("https://app.test/api/status"), env)).json();
    expect(status.signal.reachable.seoul).toBe(false);
  });
  it("rejects prototype service names without making a provider call", async () => {
    const fetcher = vi.fn();
    const response = await handleApi(new Request("https://app.test/api/signals/seoul?service=constructor&itstId=20386"), env, fetcher);
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
