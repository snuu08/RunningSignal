import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./api.ts";
import { evaluateSignalCandidates } from "./signal-service.ts";
import { forecastRemaining, type Crossing, type FixedPlan, type Route } from "../src/real/core.ts";

// Synthetic Seoul coordinates and plans. These are not field observations.
const now = Date.parse("2026-10-11T12:00:00+09:00");
const plan = (entryStartSec: number, entryEndSec: number, clearEndSec: number): FixedPlan => ({
  cycleSec: 90, epochMs: now, entryStartSec, entryEndSec, clearEndSec,
  validFromMs: now - 1000, validToMs: now + 3_600_000,
  verifiedAtMs: now, uncertaintySec: 1,
});
const route = (id: string, distanceM: number): Route => ({
  id, distanceM, coordinates: [[127.03, 37.51], [127.03, 37.52]],
  name: id, option: "4", instructions: [], sharpTurns: 0, zigzags: 0,
});
const crossing = (id: string, atM: number, fixed = plan(0, 25, 40)): Crossing => ({
  id, name: id, atM, exitAtM: atM + 30, widthM: 12, plan: fixed,
});
afterEach(() => vi.useRealTimers());

describe("Seoul pace and signal route assessment", () => {
  it("changes the selected route when 6:00/km becomes 5:00/km", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const routes = [route("short", 1000), route("detour", 1070)];
    const provider = { inspect: async (r: Route) => ({
      completeCoverage: true, source: "synthetic-test",
      crossings: [crossing(r.id, 500, r.id === "short" ? plan(60, 85, 90) : plan(0, 25, 40))],
    }) };
    const usual = await evaluateSignalCandidates(routes, 360, now, provider);
    const fast = await evaluateSignalCandidates(routes, 300, now, provider);
    expect(usual.recommendedId).toBe("detour");
    expect(usual.forecasts.short.waitSec).toBe(61);
    expect(fast.recommendedId).toBe("short");
    expect(fast.forecasts.short.waitSec).toBe(1);
    expect(usual.paceSecPerKm).toBe(360);
  });
  it("recalculates departure time and removes already passed signal waits", () => {
    const signals = [crossing("past", 100), crossing("next", 600)];
    const result = forecastRemaining(1000, 360, now, signals, true, 400);
    expect(result.crossings.map((c) => c.id)).toEqual(["next"]);
    expect(result.crossings[0].arrivalMs).toBe(now + 72_000);
    expect(result.crossings[0].atM).toBe(600);
    expect(result.waitSec).toBe(19);
    expect(result.totalSec).toBeCloseTo(237.2);
  });
  it("walks to an in-progress crossing's exit before calculating the next ETA", () => {
    const signals = [crossing("inside", 100), crossing("next", 300)];
    const result = forecastRemaining(500, 360, now, signals, true, 115);
    expect(result.crossings.map((c) => c.id)).toEqual(["next"]);
    expect(result.crossings[0].arrivalMs).toBe(now + 66_200);
  });
  it("does not treat unmapped remaining crossings as zero waiting", () => {
    expect(forecastRemaining(1000, 360, now, [], false, 400).waitSec).toBeNull();
  });
  it("uses one departure clock after a delayed signal response", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const provider = { inspect: async () => {
      vi.setSystemTime(now + 3000);
      return { completeCoverage: true, source: "synthetic-test",
        crossings: [crossing("next", 200, { ...plan(0, 25, 40), verifiedAtMs: now + 3000 })] };
    } };
    const result = await evaluateSignalCandidates([route("seoul", 1000)], 360, now, provider);
    expect(result.departureMs).toBe(now + 3000);
    expect(result.forecasts.seoul.waitSec).not.toBeNull();
    expect(result.forecasts.seoul.crossings[0].arrivalMs).toBe(now + 75_000);
  });
  it("evaluates geometry without TMAP calls or trusting a client-supplied plan", async () => {
    const upstream = vi.fn();
    const r = await handleApi(new Request("https://app.test/api/routes/evaluate", {
      method: "POST", body: JSON.stringify({ pace: 360, candidates: [{
        route: { ...route("seoul", 1000), crossings: [crossing("fake", 200)] }, traveledM: 400,
      }] }),
    }), { SIGNAL_PUBLIC_PREDICTION: "false" }, upstream);
    expect(r.status).toBe(200);
    const result = await r.json();
    expect(result.forecasts.seoul.waitSec).toBeNull();
    expect(result.paceSecPerKm).toBe(360);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([
    { pace: 0, candidates: [{ route: route("seoul", 1000) }] },
    { pace: 360, candidates: [] },
    { pace: 360, candidates: [{ route: route("seoul", 1000), traveledM: 1001 }] },
    { pace: 360, candidates: [{ route: route("seoul", 1000) }, { route: route("seoul", 1000) }] },
    { pace: 360, candidates: [{ route: { ...route("seoul", 1000), coordinates: [[37.51, 127.03], [37.52, 127.03]] } }] },
  ])("rejects invalid pace, progress and route geometry", async (body) => {
    const r = await handleApi(new Request("https://app.test/api/routes/evaluate", {
      method: "POST", body: JSON.stringify(body),
    }), {}, vi.fn());
    expect(r.status).toBe(400);
  });
});
