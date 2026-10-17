import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignalUnitCheck } from "./SignalUnitCheck.tsx";
import { CurrentStatePanel } from "./CurrentStatePanel.tsx";
const fetcher = vi.fn<typeof fetch>();
const start = () => fireEvent.click(screen.getByRole("button", { name: "단위 측정 시작" }));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000_000);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  fetcher.mockReset(); vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("bounded signal calibration UI", () => {
  it("collects at most eight samples and never enables prediction", async () => {
    let n = 0;
    fetcher.mockImplementation(async () => {
      const i = n++, at = Date.now();
      return Response.json({ resultClass: "ok-data", observation: { fresh: true, synchronized: true },
        current: { itstId: "123", sourceTimestampMs: at, fetchedAtMs: at, stale: false, missingSourceTime: false },
        data: [{ itstId: "123", eqmnId: "synthetic-device", trsmUtcTime: at,
          nePdsgStatNm: "stop-And-Remain", nePdsgRmdrCs: 500 - i * 50 }] });
    });
    render(<SignalUnitCheck itstId="123" />);
    await act(async () => start());
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(screen.getByText(/1\/10초 단위 측정됨/)).toBeTruthy();
    expect(screen.getByText(/자동으로 켜지 않습니다/)).toBeTruthy();
  });
  it("aborts an outstanding request when the view unmounts", async () => {
    fetcher.mockImplementation(() => new Promise(() => {}));
    const view = render(<SignalUnitCheck itstId="123" />);
    await act(async () => start());
    const signal = fetcher.mock.calls[0][1]!.signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("stops hidden-tab collection before another provider request", async () => {
    fetcher.mockImplementation(async () => Response.json({}));
    render(<SignalUnitCheck itstId="123" />);
    await act(async () => start());
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/화면이 숨겨져/)).toBeTruthy();
  });
  it("does not let a quota response be bypassed by changing intersection", async () => {
    fetcher.mockImplementation(async () => Response.json({ error: "quota", retryAfterMs: 90_000 }, { status: 429 }));
    const view = render(<SignalUnitCheck itstId="123" />);
    await act(async () => start());
    view.unmount();
    render(<SignalUnitCheck itstId="999" />);
    await act(async () => start());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("90초");
  });
  it("expires a once-fresh diagnostic response even without another fetch", async () => {
    const at = Date.now();
    render(<CurrentStatePanel payload={{ observation: { source: "fusion", fresh: true, synchronized: true },
      current: { itstId: "123", sourceTimestampMs: at, fetchedAtMs: at, sourceAgeMs: 0,
        stale: false, missingSourceTime: false, pedestrian: [], remainingPedestrian: [], notes: [] } }} />);
    expect(screen.getByText(/동시각 관측 수신/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    expect(screen.getByText(/현재 관측 만료/)).toBeTruthy();
    expect(screen.queryByText(/동시각 관측 수신/)).toBeNull();
  });
});
