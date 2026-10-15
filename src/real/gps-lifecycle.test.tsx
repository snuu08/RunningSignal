// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGpsRun, type GpsRunEvent } from "./useGpsRun.ts";
import { meters } from "./core.ts";

const origin: [number, number] = [127.03, 37.51];
const scale = meters(origin, [origin[0] + 1, origin[1]]);
let callbacks: Map<number, PositionCallback>;
let nextId: number;
const position = (eastM = 0, accuracy = 5) => ({
  coords: { longitude: origin[0] + eastM / scale, latitude: origin[1], accuracy },
  timestamp: Date.now(),
}) as GeolocationPosition;
function emit(eastM: number, accuracy = 5) {
  const callback = [...callbacks.values()].at(-1);
  if (!callback) throw new Error("No GPS watch");
  callback(position(eastM, accuracy));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  callbacks = new Map(); nextId = 0;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition: vi.fn((success: PositionCallback) => success(position())),
    watchPosition: vi.fn((success: PositionCallback) => { const id = ++nextId; callbacks.set(id, success); return id; }),
    clearWatch: vi.fn((id: number) => callbacks.delete(id)),
  } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("GPS screen and field evidence lifecycle (synthetic positions)", () => {
  it("restarts a suspended watch and records a background gap without bridging distance", async () => {
    const checkpoint = vi.fn(); const events: GpsRunEvent[] = [];
    const { result } = renderHook(() => useGpsRun(checkpoint, (event) => events.push(event)));
    await act(() => result.current.start(null));
    act(() => { vi.advanceTimersByTime(5000); emit(15); });
    const distance = result.current.live!.track.distanceM;
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      fireEvent(document, new Event("visibilitychange"));
    });
    expect(checkpoint).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(60_000));
    const previousWatch = [...callbacks.keys()].at(-1);
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      fireEvent(document, new Event("visibilitychange"));
    });
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(previousWatch);
    act(() => emit(200));
    expect(result.current.live!.track.distanceM).toBe(distance);
    expect(result.current.live!.track.gapSec).toBe(60);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["hidden", "visible"]));
  });
  it("does not reject a new location after a manual pause or count paused movement", async () => {
    const { result } = renderHook(() => useGpsRun(() => {}));
    await act(() => result.current.start(null));
    act(() => { vi.advanceTimersByTime(5000); result.current.pause(); });
    act(() => vi.advanceTimersByTime(60_000));
    act(() => result.current.resume());
    act(() => emit(200));
    expect(result.current.live!.track.distanceM).toBe(0);
    expect(result.current.live!.track.gapSec).toBe(0);
    act(() => { vi.advanceTimersByTime(5000); emit(215); });
    expect(result.current.live!.track.distanceM).toBeCloseTo(15, 1);
  });
  it("records rejected raw samples as evidence without adding them to the track", async () => {
    const events: GpsRunEvent[] = [];
    const { result } = renderHook(() => useGpsRun(() => {}, (event) => events.push(event)));
    await act(() => result.current.start(null));
    act(() => { vi.advanceTimersByTime(5000); emit(1000, 500); });
    expect(events.at(-1)).toMatchObject({ type: "sample", accepted: false, reason: "inaccurate", fix: { accuracy: 500 } });
    expect(result.current.live!.track.distanceM).toBe(0);
  });
  it("saves pagehide immediately, emits one end event, and ignores late watch callbacks", async () => {
    const checkpoint = vi.fn(); const events: GpsRunEvent[] = [];
    const { result } = renderHook(() => useGpsRun(checkpoint, (event) => events.push(event)));
    await act(() => result.current.start(null));
    const callback = [...callbacks.values()].at(-1)!;
    act(() => fireEvent(window, new Event("pagehide")));
    expect(checkpoint).toHaveBeenCalled();
    act(() => { result.current.end(); result.current.end(); });
    act(() => { vi.advanceTimersByTime(5000); callback(position(15)); });
    expect(events.filter((event) => event.type === "end")).toHaveLength(1);
    expect(result.current.live!.track.distanceM).toBe(0);
  });
});
