import { describe, expect, it, vi } from "vitest";
import { fetchTdataService, interpretCurrentState } from "./tdata.ts";
import { parseVerifiedBundle } from "./provider.ts";

const now = Date.parse("2026-10-11T12:00:00+09:00");
describe("Seoul current-state contract", () => {
  it("selects the latest matching intersection instead of the first history row", () => {
    const view = interpretCurrentState([
      { itstId: "1850", trsmUtcTime: now - 30_000, ntPdsgStatNm: "stop-And-Remain" },
      { itstId: "9999", trsmUtcTime: now, ntPdsgStatNm: "wrong intersection" },
      { itstId: "1850", trsmUtcTime: now - 1000, ntPdsgStatNm: "protected-Movement-Allowed", ntPdsgRmdrCs: 210 },
    ], now, "current", "1850");
    expect(view.sourceTimestampMs).toBe(now - 1000);
    expect(view.pedestrian[0].statusName).toBe("protected-Movement-Allowed");
    expect(view.remainingPedestrian[0].raw).toBe(210);
    expect(view.remainingPedestrian[0].seconds).toBeNull();
  });
  it("does not mistake a missing source clock or register-date digits for epoch ms", () => {
    expect(interpretCurrentState({ itstId: "1850" }, now, "current").sourceTimestampMs).toBeNull();
    expect(interpretCurrentState({ itstId: "1850", regDt: "20261011120000" }, now, "current").sourceTimestampMs).toBeNull();
    expect(interpretCurrentState({ itstId: "1850", regDt: "2026-10-11T03:00:00.000+00:00" }, now, "current").sourceTimestampMs).toBe(now);
  });
  it("calls the documented fusion endpoint with lowercase apikey and exact itstId", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json([{ itstId: "1850" }]));
    await fetchTdataService("current", "test-key", fetcher, { itstId: "1850" });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe("/apig/apiman-gateway/tapi/v2xSignalPhaseTimingFusionCurrentInfo/1.0");
    expect(url.searchParams.get("itstId")).toBe("1850");
    expect(url.searchParams.get("apikey")).toBe("test-key");
    expect(url.searchParams.has("apiKey")).toBe(false);
  });
  it("requires explicit unit and direction evidence before enabling live mapping", () => {
    const raw = { liveMappings: [{ crossingInternalId: "x", direction: "nt", remainingUnit: "unknown", verifiedAtMs: now, evidence: "" }] };
    expect(parseVerifiedBundle(raw).liveMappings).toEqual([]);
  });
});
