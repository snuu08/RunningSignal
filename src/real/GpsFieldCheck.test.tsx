// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GpsFieldCheck } from "./GpsFieldCheck.tsx";
import { readState } from "./storage.ts";
import type { GpsFieldReport } from "./gps-field.ts";

beforeEach(() => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition: vi.fn((success: PositionCallback) => success({
      coords: { longitude: 127.03, latitude: 37.51, accuracy: 5 }, timestamp: Date.now(),
    } as GeolocationPosition)),
    watchPosition: vi.fn(() => 31), clearWatch: vi.fn(),
  } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("field GPS check screen", () => {
  it("uses real recording lifecycle, saves evidence separately, and stays insufficient after a short test", async () => {
    const owner = `field-test-${crypto.randomUUID()}`;
    render(<GpsFieldCheck owner={owner} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "새 검사 시작" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "새 검사 시작" }));
    await screen.findByRole("button", { name: "검사 종료·저장" });
    expect(screen.getByText(/측정 중/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "검사 일시정지" }));
    expect(screen.getByRole("button", { name: "검사 계속하기" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "검사 계속하기" }));
    fireEvent.click(screen.getByRole("button", { name: "검사 종료·저장" }));
    expect(screen.getByText(/판정 대기/)).toBeTruthy();
    let stored: GpsFieldReport | undefined;
    await waitFor(async () => {
      stored = await readState<GpsFieldReport>(`gps-field:${owner}`);
      expect(stored?.run?.phase).toBe("ended");
    });
    expect(stored!.events.map((event) => event.type)).toEqual(expect.arrayContaining(["start", "sample", "pause", "resume", "end"]));
    expect(stored!.source).toBe("browser-geolocation");
    expect(await readState(`active:${owner}`)).toBeUndefined();
  });
  it("does not request location when an independent reference distance is invalid", async () => {
    render(<GpsFieldCheck owner={`invalid-${crypto.randomUUID()}`} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "새 검사 시작" }).hasAttribute("disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("검사 종류"), { target: { value: "distance" } });
    fireEvent.change(screen.getByLabelText("기준 거리 (m)"), { target: { value: "0" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "새 검사 시작" })));
    expect(screen.getByRole("alert").textContent).toContain("100~50,000m");
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
});
