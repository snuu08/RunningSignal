// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useGpsRun } from "./useGpsRun.ts";
import {
  defaultProfile,
  listRuns,
  saveRun,
  saveState,
  type RunRecord,
} from "./storage.ts";
import { RealApp } from "./RealApp.tsx";
vi.mock("./RealMap.tsx", () => ({
  RealMap: () => <div>Map component test boundary</div>,
}));
vi.mock("./backend.ts", async () => {
  const actual =
    await vi.importActual<typeof import("./backend.ts")>("./backend.ts");
  return { ...actual, cloud: null, publicRoutes: async () => [] };
});
function resetIdb() {
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("flow-run-real-v1");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
  await resetIdb();
});
describe("GPS lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1800000000000);
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success) =>
          success({
            coords: { longitude: 127, latitude: 37, accuracy: 5 },
            timestamp: Date.now(),
          }),
        ),
        watchPosition: vi.fn(() => 42),
        clearWatch: vi.fn(),
      },
    });
  });
  it("starts at the actual button time, separates pauses, resumes, and ends exactly once", async () => {
    const { result } = renderHook(() => useGpsRun(() => {}));
    await act(() => result.current.start(null));
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.live?.activeSec).toBe(10);
    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.live?.manualPauseSec).toBe(5);
    expect(result.current.live?.activeSec).toBe(10);
    act(() => result.current.resume());
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current.end());
    act(() => vi.advanceTimersByTime(8000));
    expect(result.current.live?.activeSec).toBe(13);
    expect(result.current.live?.phase).toBe("ended");
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(42);
  });
  it("does not start a mapped run far from its departure", async () => {
    const { result } = renderHook(() => useGpsRun(() => {}));
    await expect(
      result.current.start({
        id: "r",
        name: "r",
        coordinates: [
          [128, 38],
          [128, 38.01],
        ],
        distanceM: 1000,
        sharpTurns: 0,
        zigzags: 0,
        option: "0",
        instructions: [],
      }),
    ).rejects.toThrow("100m");
    expect(result.current.live).toBeNull();
  });
});
describe("real-mode screen flow", () => {
  beforeEach(() => {
    sessionStorage.setItem("flow-real-guest", "yes");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          places: false,
          routes: false,
          seoulSignals: false,
          signalPrediction: false,
        }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  it("saves onboarding and exposes real entry points without provider keys", async () => {
    await saveState("profile:guest", defaultProfile);
    render(
      <MemoryRouter initialEntries={["/real/home"]}>
        <RealApp />
      </MemoryRouter>,
    );
    await screen.findByLabelText("닉네임");
    fireEvent.change(screen.getByLabelText("닉네임"), {
      target: { value: "테스트러너" },
    });
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    const search = await screen.findByRole("button", { name: "러닝 경로 찾기" });
    expect((search as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "자유 러닝" }));
    expect(screen.getByRole("button", { name: "자유 러닝 시작" })).toBeTruthy();
    expect(screen.queryByLabelText("목적지")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "목적지까지" }));
    fireEvent.click(screen.getByText("페이스·경유지 설정"));
    fireEvent.click(screen.getByRole("button", { name: "+ 꼭 지나고 싶은 장소" }));
    expect(screen.getByLabelText("경유지")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "페이스를 모르겠어요" }));
    await screen.findByLabelText("거리 (km)");
    fireEvent.change(screen.getByLabelText("거리 (km)"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("걸린 시간 (분)"), {
      target: { value: "25" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "선택한 칸에 저장" }),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("페이스 분") as HTMLInputElement).value,
      ).toBe("5"),
    );
  });
  it("selects places by keyboard, swaps endpoints, and invalidates an edited selection", async () => {
    await saveState("profile:guest", { ...defaultProfile, onboarded: true });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("places?")) {
        const name = new URL(url, "http://localhost").searchParams.get("q")!;
        return Response.json({ places: [{ id: name, name, coord: [127, 37.5] }] });
      }
      return Response.json({ places: true, routes: true, signalPrediction: false });
    });
    render(<MemoryRouter initialEntries={["/real/home"]}><RealApp /></MemoryRouter>);
    const origin = await screen.findByRole("combobox", { name: "출발지" });
    const destination = screen.getByRole("combobox", { name: "목적지" });
    for (const [input, name] of [[origin, "서울숲"], [destination, "뚝섬역"]] as const) {
      fireEvent.change(input, { target: { value: name } });
      await screen.findByRole("option", { name });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
      fireEvent.keyDown(input, { key: "Enter" });
    }
    expect((screen.getByRole("button", { name: "러닝 경로 찾기" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "출발지와 목적지 바꾸기" }));
    expect((origin as HTMLInputElement).value).toBe("뚝섬역");
    expect((destination as HTMLInputElement).value).toBe("서울숲");
    fireEvent.change(origin, { target: { value: "새" } });
    expect((screen.getByRole("button", { name: "러닝 경로 찾기" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("keeps signup unavailable when no real auth server exists", async () => {
    render(
      <MemoryRouter initialEntries={["/real/auth"]}>
        <RealApp />
      </MemoryRouter>,
    );
    const login = await screen.findByRole("button", { name: "로그인" });
    expect((login as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "카카오로 계속" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Google로 계속" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "계정 없이 기기에 기록하기" }),
    ).toBeTruthy();
  });
});
describe("record identity and account isolation", () => {
  it("saves retries idempotently and keeps all dates without crossing accounts", async () => {
    const make = (id: string, owner: string): RunRecord => ({
      id,
      owner,
      title: "코스",
      route: null,
      routeKey: "same-course",
      track: { fixes: [], distanceM: 1000, stoppedSec: 0, gapSec: 0 },
      activeSec: 360,
      elapsedSec: 360,
      manualPauseSec: 0,
      startedAt: 1,
      finishedAt: 361000,
      complete: false,
      synced: false,
    });
    await saveRun(make("a", "one"));
    await saveRun(make("a", "one"));
    await saveRun(make("b", "one"));
    await saveRun(make("c", "two"));
    expect((await listRuns("one")).map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(await listRuns("two")).toHaveLength(1);
  });
});
