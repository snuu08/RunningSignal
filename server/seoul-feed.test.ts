import { afterEach, describe, expect, it, vi } from "vitest";
import { createSeoulFeedClient, joinSeoulPhaseTiming } from "./seoul-feed.ts";
import { handleApi, resetApiRuntimeForTests } from "./api.ts";
import { fetchTdataService, parseRetryAfter } from "../src/real/signals/tdata.ts";

// Synthetic packets test transport rules only. They are not field observations.
const now = Date.parse("2026-10-17T00:00:00Z");
const phase = (extra: Record<string, unknown> = {}) => ({ itstId: "1850", dataId: "packet-1",
  eqmnId: "controller-1", trsmUtcTime: now, ntPdsgStatNm: "stop-And-Remain", ...extra });
const timing = (extra: Record<string, unknown> = {}) => ({ itstId: "1850", dataId: "packet-1",
  eqmnId: "controller-1", trsmUtcTime: now, ntPdsgRmdrCs: 300, ...extra });
afterEach(() => { vi.useRealTimers(); resetApiRuntimeForTests(); });

describe("Seoul observation acquisition", () => {
  it("uses fresh fusion data directly and coalesces concurrent candidate requests", async () => {
    const fetcher = vi.fn(async () => Response.json([{ ...phase(), ...timing() }]));
    let clock = now;
    const feed = createSeoulFeedClient("test-secret", fetcher, () => clock);
    const [a, b] = await Promise.all([feed.snapshot("1850"), feed.snapshot("1850")]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ source: "fusion", synchronized: true, fresh: true, sourceTimestampMs: now });
    expect(b.data).toEqual(a.data);
    clock += 11_000;
    const stale = await feed.snapshot("1850");
    expect(stale.fresh).toBe(false);
    expect(stale.sourceAgeMs).toBe(11_000);
    expect(stale.issues).toContain("stale-source-time");
  });
  it("falls back from missing fusion to same-packet current endpoints, never historical rows", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("FusionCurrentInfo")) return Response.json({ responseCode: 404 }, { status: 404 });
      expect(new URL(url).searchParams.get("apikey")).toBe("test-secret");
      expect(url).toMatch(/v2xSignalPhase(Timing)?CurrentInfo/);
      return Response.json(url.includes("TimingCurrentInfo") ? [timing()] : [phase()]);
    });
    const result = await createSeoulFeedClient("test-secret", fetcher, () => now).snapshot("1850");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ source: "current-phase+timing", fresh: true, synchronized: true });
    expect(result.data).toEqual([{ ...phase(), ...timing() }]);
    expect(result.issues).toEqual(["fusion-unavailable"]);
  });
  it("never joins older matching rows when either newest packet differs", () => {
    const old = now - 1000;
    expect(joinSeoulPhaseTiming([phase({ trsmUtcTime: old }), phase()], [timing({ trsmUtcTime: old })], "1850")).toBeNull();
    expect(joinSeoulPhaseTiming([phase()], [timing({ itstId: "9999" })], "1850")).toBeNull();
    expect(joinSeoulPhaseTiming([phase()], [timing({ dataId: "packet-2" })], "1850")).toBeNull();
    expect(joinSeoulPhaseTiming([phase()], [timing({ eqmnId: "controller-2" })], "1850")).toBeNull();
    expect(joinSeoulPhaseTiming([phase(), phase({ ntPdsgStatNm: "protected-Movement-Allowed" })], [timing()], "1850")).toBeNull();
  });
  it("normalizes documented source epoch seconds and retains nonempty phase fields", () => {
    expect(joinSeoulPhaseTiming([phase({ trsmUtcTime: now / 1000 })],
      [timing({ ntPdsgStatNm: null })], "1850")).toMatchObject({ trsmUtcTime: now, ntPdsgStatNm: "stop-And-Remain" });
  });
  it.each([401, 403, 429, 502])("does not fan out to other services after HTTP %s", async (status) => {
    const fetcher = vi.fn(async () => Response.json({ error: "upstream" }, { status }));
    const feed = createSeoulFeedClient("test-secret", fetcher, () => now);
    const result = await feed.snapshot("1850");
    expect(result.fresh).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("honors Retry-After across services and intersections without serving cached success", async () => {
    let clock = now;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json([{ ...phase(), ...timing() }]))
      .mockResolvedValueOnce(Response.json({ responseCode: 429 }, { status: 429, headers: { "Retry-After": "120" } }))
      .mockResolvedValue(Response.json([{ ...phase(), ...timing() }]));
    const feed = createSeoulFeedClient("test-secret", fetcher, () => clock);
    await feed.snapshot("1850");
    await feed.read("phase", "1850");
    const blocked = await feed.snapshot("1850");
    expect(blocked.result.class).toBe("rate-limited");
    expect(blocked.data).toBeNull();
    expect(blocked.retryAfterMs).toBe(120_000);
    clock += 119_999;
    expect((await feed.read("timing", "9999")).class).toBe("rate-limited");
    expect(fetcher).toHaveBeenCalledTimes(2);
    clock += 1;
    await feed.read("current", "1850");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("classifies an HTTP 200 quota envelope and parses both Retry-After formats", async () => {
    const result = await fetchTdataService("current", "test-secret",
      async () => Response.json({ responseCode: 429 }), { itstId: "1850" });
    expect(result.class).toBe("rate-limited");
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter(new Date(now + 90_000).toUTCString(), now)).toBe(90_000);
    expect(parseRetryAfter("invalid", now)).toBeNull();
  });
  it("returns a quota retry time through the API and suppresses a second warm request", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const fetcher = vi.fn(async () => Response.json({ error: "limit" }, { status: 429, headers: { "Retry-After": "120" } }));
    const env = { SEOUL_TDATA_API_KEY: "test-secret" };
    const request = () => new Request("https://app.test/api/signals/seoul?service=current&itstId=1850");
    const first = await handleApi(request(), env, fetcher);
    expect(first.status).toBe(429);
    expect(first.headers.get("retry-after")).toBe("120");
    expect(await first.json()).toMatchObject({ retryAfterMs: 120_000 });
    await handleApi(request(), env, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("honors the provider's JSON repeat-call cooldown for one API across intersections", async () => {
    let clock = now;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: 429, code: "V2X_REPEAT_CALL_LIMIT",
        api: "v2xSignalPhaseInformation", limitSeconds: 300, retryAfterSeconds: 232,
        nextCallAvailableAt: "2026-10-17 09:22:39" }, { status: 429 }))
      .mockResolvedValue(Response.json([{ ...phase(), ...timing() }]));
    const feed = createSeoulFeedClient("test-secret", fetcher, () => clock);
    expect(await feed.read("phase", "1850")).toMatchObject({ class: "rate-limited",
      retryAfterMs: 232_000, rateLimitScope: "service" });
    expect(feed.retryAfterMs("phase")).toBe(232_000);
    expect(feed.retryAfterMs("current")).toBeNull();
    expect((await feed.read("phase", "9999")).class).toBe("rate-limited");
    expect((await feed.snapshot("1850")).fresh).toBe(true);
    clock += 231_999;
    expect((await feed.read("phase", "9999")).retryAfterMs).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    clock += 1;
    await feed.read("phase", "9999");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([
    [{ status: 429, retryAfterSeconds: "232.0001" }, null, 232_001, "account"],
    [{ status: 429, retryAfterSeconds: 232 }, "300", 300_000, "account"],
    [{ code: "V2X_REPEAT_CALL_LIMIT", api: "v2xSignalPhaseInformation", limitSeconds: 300 }, null, 300_000, "service"],
    [{ code: "V2X_REPEAT_CALL_LIMIT", api: "another-service", limitSeconds: 300 }, null, 300_000, "account"],
    [{ status: 429, retryAfterSeconds: -1, nextCallAvailableAt: "2026-10-17 09:22:39" }, null, null, "account"],
    [{ status: 429, retryAfterSeconds: "", limitSeconds: 300 }, null, null, "account"],
    [{ status: 429, retryAfterSeconds: true }, null, null, "account"],
  ])("parses quota envelopes without guessing timestamp zones: %j", async (body, header, delay, scope) => {
    const result = await fetchTdataService("phase", "test-secret", async () =>
      Response.json(body, { headers: header ? { "Retry-After": header as string } : {} }));
    expect(result).toMatchObject({ class: "rate-limited", retryAfterMs: delay, rateLimitScope: scope });
  });
  it("returns the JSON service cooldown through the API without blocking current data", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: 429, code: "V2X_REPEAT_CALL_LIMIT",
        api: "v2xSignalPhaseInformation", retryAfterSeconds: 232 }, { status: 429 }))
      .mockResolvedValue(Response.json([{ ...phase(), ...timing() }]));
    const env = { SEOUL_TDATA_API_KEY: "test-secret" };
    const request = (service: string, id = "1850") => new Request(`https://app.test/api/signals/seoul?service=${service}&itstId=${id}`);
    const limited = await handleApi(request("phase"), env, fetcher);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("232");
    expect(await limited.json()).toMatchObject({ retryAfterMs: 232_000 });
    await handleApi(request("phase", "9999"), env, fetcher);
    expect((await handleApi(request("current"), env, fetcher)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
