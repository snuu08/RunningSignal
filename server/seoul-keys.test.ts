import { afterEach, describe, expect, it, vi } from "vitest";
import { seoulCredentialsFrom, seoulServiceConfiguration } from "./seoul-keys.ts";
import { functionEnvFrom, vitePrefixedSecretNames } from "./function-env.ts";
import { createSeoulFeedClient } from "./seoul-feed.ts";
import { handleApi, resetApiRuntimeForTests } from "./api.ts";

afterEach(() => { vi.useRealTimers(); resetApiRuntimeForTests(); });
describe("dataset-specific Seoul credentials", () => {
  it("overrides only the named dataset and preserves a trimmed shared fallback", () => {
    const keys = seoulCredentialsFrom({ SEOUL_TDATA_API_KEY: " shared ",
      SEOUL_TDATA_CURRENT_API_KEY: " fusion ", SEOUL_TDATA_PHASE_CURRENT_API_KEY: " " });
    expect(keys.current).toBe("fusion");
    expect(keys["phase-current"]).toBe("shared");
    expect(keys.phase).toBe("shared");
    expect(Object.values(seoulServiceConfiguration(keys)).every(Boolean)).toBe(true);
  });
  it("reads dataset keys from Netlify runtime and rejects public aliases", () => {
    const env = functionEnvFrom({}, (name) =>
      name === "SEOUL_TDATA_CURRENT_API_KEY" ? "server-only" : undefined);
    expect(seoulCredentialsFrom(env).current).toBe("server-only");
    expect(vitePrefixedSecretNames({ VITE_SEOUL_TDATA_CURRENT_API_KEY: "bad" }))
      .toEqual(["VITE_SEOUL_TDATA_CURRENT_API_KEY"]);
  });
  it("uses the matching key and isolates only explicitly service-scoped cooldowns", async () => {
    let clock = 1_000;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const key = url.searchParams.get("apikey") ?? url.searchParams.get("apiKey");
      if (key === "limited-key") return Response.json({ code: "V2X_REPEAT_CALL_LIMIT",
        api: "v2xSignalPhaseInformation", retryAfterSeconds: 120 },
        { status: 429, headers: { "Retry-After": "120" } });
      expect(key).toBe("other-key");
      return Response.json([]);
    });
    const feed = createSeoulFeedClient({ phase: "limited-key", timing: "limited-key",
      current: "other-key" }, fetcher, () => clock);
    expect((await feed.read("phase", "20386")).class).toBe("rate-limited");
    clock += 1_000;
    expect((await feed.read("phase", "9999")).retryAfterMs).toBe(119_000);
    expect((await feed.read("current", "20386")).class).toBe("ok-empty");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps an unknown quota limit account-wide even when dataset keys differ", async () => {
    const fetcher = vi.fn(async () => Response.json({ responseCode: 429 },
      { status: 429, headers: { "Retry-After": "120" } }));
    const feed = createSeoulFeedClient({ phase: "key-a", current: "key-b" }, fetcher);
    await feed.read("phase", "20386");
    expect((await feed.read("current", "20386")).class).toBe("rate-limited");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("can join the current-only pair when only those two dataset keys are configured", async () => {
    const at = Date.now();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const timing = url.pathname.includes("TimingCurrentInfo");
      expect(url.searchParams.get("apikey")).toBe(timing ? "timing-key" : "phase-key");
      return Response.json([{ itstId: "20386", trsmUtcTime: at, dataId: "packet",
        eqmnId: "controller", ...(timing ? { ntPdsgRmdrCs: 200 } :
          { ntPdsgStatNm: "stop-And-Remain" }) }]);
    });
    const feed = createSeoulFeedClient({ "phase-current": "phase-key",
      "timing-current": "timing-key" }, fetcher, () => at);
    expect(await feed.snapshot("20386")).toMatchObject({ synchronized: true,
      fresh: true, source: "current-phase+timing" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not call an unconfigured dataset and exposes configuration booleans only", async () => {
    const fetcher = vi.fn(async () => Response.json([]));
    const env = { SEOUL_TDATA_CURRENT_API_KEY: "private-fusion-key" };
    const status = await handleApi(new Request("https://app.test/api/status"), env, fetcher);
    const body = await status.json();
    expect(body.seoulSignals).toBe(true);
    expect(body.seoulServicesConfigured).toMatchObject({ current: true, phase: false });
    expect(JSON.stringify(body)).not.toContain("private-fusion-key");
    const missing = await handleApi(new Request(
      "https://app.test/api/signals/seoul?service=phase&itstId=20386"), env, fetcher);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ providerResponse: {
      service: "phase", errorType: "missing_api_key" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
