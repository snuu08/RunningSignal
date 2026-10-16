import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Route } from "./core.ts";
import { useLiveRouteForecast } from "./useLiveRouteForecast.ts";

const route: Route = { id: "seoul", name: "서울", coordinates: [[127.03, 37.51], [127.03, 37.52]], distanceM: 1000, option: "4", sharpTurns: 0, zigzags: 0, instructions: [] };
const input = { route, runId: "run1", running: true, enabled: true, pace: 360, traveledM: 0 };
const response = { recommendedId: route.id, forecasts: {}, departureMs: 1, signalCoverage: "unknown", recommendationReason: "walking-baseline" };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("live route signal refresh", () => {
  it("refreshes at departure and uses the latest GPS pace and progress after 5 seconds", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json(response));
    vi.stubGlobal("fetch", fetcher);
    const { rerender, result } = renderHook((props) => useLiveRouteForecast(props), { initialProps: input });
    await act(async () => {});
    expect(result.current.assessment).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    rerender({ ...input, pace: 300, traveledM: 200 });
    await act(async () => vi.advanceTimersByTime(5000));
    const payload = JSON.parse(String(fetcher.mock.calls[1][1].body));
    expect(fetcher.mock.calls[1][0]).toBe("/api/routes/evaluate");
    expect(payload.pace).toBe(300);
    expect(payload.candidates[0].traveledM).toBe(200);
  });
  it("stops refreshes while paused and resumes with a fresh departure assessment", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => Response.json(response));
    vi.stubGlobal("fetch", fetcher);
    const { rerender, result } = renderHook((props) => useLiveRouteForecast(props), { initialProps: input });
    await act(async () => {});
    rerender({ ...input, running: false });
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.assessment).toBeNull();
    rerender(input);
    await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("clears a prior estimate after a failed refresh rather than keeping stale waiting", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(response)).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useLiveRouteForecast(input));
    await act(async () => {});
    expect(result.current.assessment).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(5000));
    expect(result.current.assessment).toBeNull();
    expect(result.current.error).toMatch(/확인하지 못/);
  });
  it("respects the evaluation API's provider backoff", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => Response.json({ ...response, refreshAfterMs: 120_000 }));
    vi.stubGlobal("fetch", fetcher);
    renderHook(() => useLiveRouteForecast(input));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(119_999));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("honors an HTTP 429 Retry-After instead of polling every 5 seconds", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => Response.json({ error: "quota" }, { status: 429, headers: { "Retry-After": "60" } }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useLiveRouteForecast(input));
    await act(async () => {});
    expect(result.current.assessment).toBeNull();
    await act(async () => vi.advanceTimersByTime(59_999));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("pauses hidden-tab polling and refreshes on return", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => Response.json(response));
    vi.stubGlobal("fetch", fetcher);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    try {
      const { result } = renderHook(() => useLiveRouteForecast(input));
      await act(async () => {});
      visibility.mockReturnValue("hidden");
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      await act(async () => vi.advanceTimersByTime(60_000));
      expect(result.current.assessment).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
      visibility.mockReturnValue("visible");
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { visibility.mockRestore(); }
  });
  it("retains a server backoff after pause/resume", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => Response.json({ ...response, refreshAfterMs: 60_000 }));
    vi.stubGlobal("fetch", fetcher);
    const { rerender } = renderHook((props) => useLiveRouteForecast(props), { initialProps: input });
    await act(async () => {});
    rerender({ ...input, running: false });
    await act(async () => vi.advanceTimersByTime(10_000));
    rerender(input);
    await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(50_000));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
