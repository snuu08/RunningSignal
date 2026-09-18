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
import { acquireLocation, useGpsRun } from "./useGpsRun.ts";
import type { Route } from "./core.ts";
import {
  defaultProfile,
  listRuns,
  saveRun,
  saveState,
  type RunRecord,
} from "./storage.ts";
import { RealApp } from "./RealApp.tsx";
const realMapRenders = vi.hoisted(() => [] as Record<string, any>[]);
vi.mock("./RealMap.tsx", () => ({
  RealMap: (props: Record<string, any>) => {
    realMapRenders.push(props);
    return (
      <div
        data-testid="real-map"
        data-follow={String(!!props.follow)}
        data-position={JSON.stringify(props.position ?? null)}
        data-accuracy={String(props.positionAccuracyM ?? "")}
        data-focus-token={String(props.positionFocusToken ?? "")}
        data-route-points={String(props.coordinates?.length ?? 0)}
        data-pois={JSON.stringify(props.pois ?? [])}
      >
        Map component test boundary
        <button type="button" onClick={() => props.onUserPan?.()}>
          mock manual pan
        </button>
        <button type="button" onClick={() => props.onPick?.([127.2, 37.8])}>
          mock map pick
        </button>
      </div>
    );
  },
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

function statusBody() {
  return {
    places: true,
    routes: true,
    seoulSignals: false,
    reverseGeocode: true,
    signalPrediction: false,
    signalDetail: "테스트",
    signal: {
      configured: { seoul: false, utic: false, national: false },
      reachable: { seoul: null, utic: null, national: null },
      mappingReady: false,
      predictionReady: false,
      predictionByRegion: { 서울: false, 인천: false, 대구: false, 성남: false },
    },
    utic: { configured: false, ready: false, detail: "테스트" },
    national: { configured: false, ready: false, detail: "테스트" },
  };
}

function routeFixture(partial: Partial<Route> = {}): Route {
  return {
    id: "route-a",
    name: "테스트 경로",
    coordinates: [
      [127, 37],
      [127.001, 37],
      [127.002, 37],
    ],
    distanceM: 220,
    sharpTurns: 0,
    zigzags: 0,
    option: "4",
    instructions: [],
    nearbyPois: [],
    ...partial,
  };
}

function routesBody(route = routeFixture(), partial = false) {
  return {
    routes: [route],
    partial,
    recommendedId: route.id,
    recommendationReason: "walking-baseline",
    recommendSentences: ["보행 조건과 우회 제한을 적용한 기본 추천입니다."],
    forecasts: {},
    departureMs: Date.now(),
    signalCoverage: "unknown",
  };
}

function installGoodGeolocation(
  coord: { longitude: number; latitude: number; accuracy: number; heading?: number | null } = {
    longitude: 127,
    latitude: 37,
    accuracy: 8,
  },
) {
  let watchSuccess: ((p: GeolocationPosition) => void) | null = null;
  const position = (
    next = coord,
    timestamp = Date.now(),
  ): GeolocationPosition =>
    ({ coords: next, timestamp }) as GeolocationPosition;
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((success) => success(position())),
      watchPosition: vi.fn((success) => {
        watchSuccess = success;
        const start = Date.now();
        success(position(coord, start));
        success(
          position(
            { ...coord, longitude: coord.longitude + 0.000001 },
            start + 800,
          ),
        );
        success(
          position(
            { ...coord, latitude: coord.latitude + 0.000001 },
            start + 1_700,
          ),
        );
        return 42;
      }),
      clearWatch: vi.fn(),
    },
  });
  return (next = coord, timestamp = Date.now()) => {
    if (!watchSuccess) throw new Error("watchPosition was not registered");
    watchSuccess(position(next, timestamp));
  };
}

function latestMapProps() {
  const props = realMapRenders.at(-1);
  if (!props) throw new Error("RealMap was not rendered");
  return props;
}

afterEach(async () => {
  cleanup();
  realMapRenders.length = 0;
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

  it("waits long enough for laptop display geolocation before timing out", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success) =>
          window.setTimeout(
            () =>
              success({
                coords: { longitude: 127.12, latitude: 37.44, accuracy: 65 },
                timestamp: Date.now(),
              } as GeolocationPosition),
            6_000,
          ),
        ),
        watchPosition: vi.fn(() => 7),
        clearWatch: vi.fn(),
      },
    });

    const acquired = acquireLocation({ purpose: "display" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    await expect(acquired).resolves.toMatchObject({
      fix: { coord: [127.12, 37.44], accuracy: 65 },
      quality: "usable",
    });
    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 10_000,
      }),
    );
  });
  it("starts a mapped run when startup GPS samples cluster around the departure", async () => {
    const fixes = [
      { longitude: 127, latitude: 37, accuracy: 60 },
      { longitude: 127, latitude: 37.001, accuracy: 18 },
      { longitude: 127.00002, latitude: 37.00101, accuracy: 16 },
      { longitude: 126.99998, latitude: 37.00099, accuracy: 14 },
      { longitude: 127.00001, latitude: 37.00102, accuracy: 18 },
    ];
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success) =>
          success({
            coords: fixes[0],
            timestamp: Date.now(),
          }),
        ),
        watchPosition: vi.fn((success) => {
          for (const [index, coords] of fixes.slice(1).entries())
            success({ coords, timestamp: Date.now() + (index + 1) * 1000 });
          return 42;
        }),
        clearWatch: vi.fn(),
      },
    });
    const { result } = renderHook(() => useGpsRun(() => {}));
    await act(() =>
      result.current.start({
        id: "r",
        name: "r",
        coordinates: [
          [127, 37.001],
          [127, 37.002],
        ],
        distanceM: 1000,
        sharpTurns: 0,
        zigzags: 0,
        option: "0",
        instructions: [],
      }),
    );
    expect(result.current.live?.phase).toBe("running");
    expect(result.current.fix?.accuracy).toBeLessThan(30);
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(42);
  });
  it("starts a free run with usable 60m GPS instead of blocking on the old 30m rule", async () => {
    const fixes = [
      { longitude: 127, latitude: 37, accuracy: 60 },
      { longitude: 127.00001, latitude: 37.00001, accuracy: 58 },
      { longitude: 127.00002, latitude: 37.00002, accuracy: 62 },
    ];
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success) =>
          success({ coords: fixes[0], timestamp: Date.now() }),
        ),
        watchPosition: vi.fn((success) => {
          for (const [index, coords] of fixes.slice(1).entries())
            success({ coords, timestamp: Date.now() + (index + 1) * 1000 });
          return 42;
        }),
        clearWatch: vi.fn(),
      },
    });
    const { result } = renderHook(() => useGpsRun(() => {}));

    await act(() => result.current.start(null));

    expect(result.current.live?.phase).toBe("running");
    expect(result.current.fix?.accuracy).toBeGreaterThan(30);
    expect(result.current.error).not.toContain("30m");
  });
  it("allows a mapped run when the GPS accuracy circle overlaps the selected departure", async () => {
    const fixes = [
      { longitude: 126.9225, latitude: 37.57961, accuracy: 55 },
      { longitude: 126.92252, latitude: 37.57962, accuracy: 52 },
      { longitude: 126.92251, latitude: 37.5796, accuracy: 50 },
    ];
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success) =>
          success({ coords: fixes[0], timestamp: Date.now() }),
        ),
        watchPosition: vi.fn((success) => {
          for (const [index, coords] of fixes.slice(1).entries())
            success({ coords, timestamp: Date.now() + (index + 1) * 1000 });
          return 42;
        }),
        clearWatch: vi.fn(),
      },
    });
    const { result } = renderHook(() => useGpsRun(() => {}));
    await act(() =>
      result.current.start(
        {
          id: "r",
          name: "r",
          coordinates: [
            [126.923, 37.57961],
            [126.924, 37.58],
          ],
          distanceM: 1000,
          sharpTurns: 0,
          zigzags: 0,
          option: "0",
          instructions: [],
        },
        [126.92277, 37.57961],
      ),
    );
    expect(result.current.live?.phase).toBe("running");
    expect(result.current.fix?.accuracy).toBeGreaterThan(30);
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
      expect(screen.getByText(/5분 00초\/km/)).toBeTruthy(),
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
  it("moves the map to current location, shows endpoints, route, accuracy, and TMAP partial notice", async () => {
    await saveState("profile:guest", { ...defaultProfile, onboarded: true });
    installGoodGeolocation({ longitude: 127.1, latitude: 37.4, accuracy: 12 });
    const route = routeFixture({
      coordinates: [
        [127.1, 37.4],
        [127.15, 37.42],
        [127.2, 37.44],
      ],
    });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("status")) return Response.json(statusBody());
      if (url.includes("places/reverse"))
        return Response.json({
          place: { id: "rev:current", name: "현재 위치", coord: [127.1, 37.4] },
        });
      if (url.includes("places?")) {
        const name = new URL(url, "http://localhost").searchParams.get("q")!;
        return Response.json({
          places: [{ id: name, name, coord: [127.2, 37.44] }],
        });
      }
      if (url.includes("routes")) return Response.json(routesBody(route, true));
      return Response.json({});
    });

    render(<MemoryRouter initialEntries={["/real/home"]}><RealApp /></MemoryRouter>);
    await screen.findByRole("combobox", { name: "출발지" });
    fireEvent.click(screen.getByRole("button", { name: "현재 위치" }));

    await waitFor(() =>
      expect(latestMapProps()).toMatchObject({
        position: [127.1, 37.4],
        positionAccuracyM: 12,
      }),
    );
    expect(latestMapProps().positionFocusToken).toBeGreaterThan(0);
    expect(screen.getByText(/정확도 ±12m/)).toBeTruthy();

    const destination = screen.getByRole("combobox", { name: "목적지" });
    fireEvent.change(destination, { target: { value: "성남시청" } });
    await screen.findByRole("option", { name: "성남시청" });
    fireEvent.keyDown(destination, { key: "ArrowDown" });
    fireEvent.keyDown(destination, { key: "Enter" });
    await waitFor(() =>
      expect(
        latestMapProps().pois.some((p: { kind?: string }) => p.kind === "origin"),
      ).toBe(true),
    );
    expect(
      latestMapProps().pois.some((p: { kind?: string }) => p.kind === "destination"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "러닝 경로 찾기" }));
    await screen.findByText("오늘의 경로가 준비됐어요.", undefined, {
      timeout: 3_000,
    });
    expect(screen.getByText("일부 후보 요청이 실패해 확인된 경로만 보여드려요.")).toBeTruthy();
    expect(latestMapProps().coordinates).toEqual(route.coordinates);
    expect(
      latestMapProps().pois.some((p: { kind?: string }) => p.kind === "origin"),
    ).toBe(true);
    expect(
      latestMapProps().pois.some((p: { kind?: string }) => p.kind === "destination"),
    ).toBe(true);
  });

  it("keeps map follow mode controllable after manual pan and restore", async () => {
    const route = routeFixture();
    const now = Date.now();
    await saveState("profile:guest", { ...defaultProfile, onboarded: true });
    await saveState("active:guest", {
      id: "live-follow",
      startedAt: now - 10_000,
      phase: "running",
      track: {
        fixes: [{ coord: [127, 37], accuracy: 8, at: now - 10_000 }],
        distanceM: 0,
        gapSec: 0,
        stoppedSec: 0,
      },
      activeSec: 0,
      manualPauseSec: 0,
      lastTick: now - 10_000,
      route,
      departure: route.coordinates[0],
    });
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).includes("status") ? Response.json(statusBody()) : Response.json({}),
    );

    render(<MemoryRouter initialEntries={["/real/run"]}><RealApp /></MemoryRouter>);
    await screen.findByText("잠시 쉬는 중");
    await waitFor(() => expect(latestMapProps().follow).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "mock manual pan" }));
    await waitFor(() => expect(latestMapProps().follow).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "내 위치 따라가기" }));
    await waitFor(() => expect(latestMapProps().follow).toBe(true));
  });

  it("passes trusted GPS heading and movement heading to the running map", async () => {
    const route = routeFixture();
    const pushFix = installGoodGeolocation({
      longitude: 127,
      latitude: 37,
      accuracy: 8,
      heading: 92,
    });
    const now = Date.now();
    await saveState("profile:guest", { ...defaultProfile, onboarded: true });
    await saveState("active:guest", {
      id: "live-heading",
      startedAt: now - 10_000,
      phase: "running",
      track: {
        fixes: [{ coord: [127, 37], accuracy: 8, at: now - 10_000 }],
        distanceM: 0,
        gapSec: 0,
        stoppedSec: 0,
      },
      activeSec: 0,
      manualPauseSec: 0,
      lastTick: now - 10_000,
      route,
      departure: route.coordinates[0],
    });
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).includes("status") ? Response.json(statusBody()) : Response.json({}),
    );

    render(<MemoryRouter initialEntries={["/real/run"]}><RealApp /></MemoryRouter>);
    await screen.findByText("잠시 쉬는 중");
    fireEvent.click(screen.getByRole("button", { name: "계속하기" }));
    await waitFor(() => expect(latestMapProps().heading).toBeCloseTo(92, 0));

    act(() =>
      pushFix(
        { longitude: 127.001, latitude: 37, accuracy: 8, heading: null },
        now + 15_000,
      ),
    );
    await waitFor(() => expect(latestMapProps().heading).toBeCloseTo(90, 0));
  });

  it("shows reroute after sustained off-route fixes and recalculates from here", async () => {
    const route = routeFixture();
    const rerouted = routeFixture({
      id: "route-rerouted",
      coordinates: [
        [127.001, 37.0006],
        [127.002, 37],
      ],
    });
    const pushFix = installGoodGeolocation({
      longitude: 127,
      latitude: 37,
      accuracy: 8,
    });
    const now = Date.now();
    await saveState("profile:guest", { ...defaultProfile, onboarded: true });
    await saveState("active:guest", {
      id: "live-offroute",
      startedAt: now - 10_000,
      phase: "running",
      track: {
        fixes: [{ coord: [127, 37], accuracy: 8, at: now - 10_000 }],
        distanceM: 0,
        gapSec: 0,
        stoppedSec: 0,
      },
      activeSec: 0,
      manualPauseSec: 0,
      lastTick: now - 10_000,
      route,
      departure: route.coordinates[0],
    });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("status")) return Response.json(statusBody());
      if (url.includes("places/reverse"))
        return Response.json({
          place: { id: "rev", name: "현재 위치", coord: [127.001, 37.0006] },
        });
      if (url.includes("routes")) return Response.json(routesBody(rerouted));
      return Response.json({});
    });

    render(<MemoryRouter initialEntries={["/real/run"]}><RealApp /></MemoryRouter>);
    await screen.findByText("잠시 쉬는 중");
    fireEvent.click(screen.getByRole("button", { name: "계속하기" }));
    await waitFor(() => expect(navigator.geolocation.watchPosition).toHaveBeenCalled());
    const offRouteAt = Date.now() + 20_000;
    for (let i = 0; i < 4; i += 1) {
      const next = {
        longitude: 127.001 + i * 0.000001,
        latitude: 37.0006,
        accuracy: 8,
      };
      act(() =>
        pushFix(
          next,
          offRouteAt + i * 3_000,
        ),
      );
      await waitFor(() =>
        expect(latestMapProps().position).toEqual([
          next.longitude,
          next.latitude,
        ]),
      );
    }
    const reroute = await screen.findByRole("button", {
      name: "현재 위치에서 경로 다시 찾기",
    });
    fireEvent.click(reroute);
    await screen.findByText("목적지·경유·계단 제외를 유지한 새 보행 경로로 바꿨어요.");
    expect(latestMapProps().coordinates).toEqual(rerouted.coordinates);
  });

  it("keeps manual map picking available when Kakao search fails", async () => {
    await saveState("profile:guest", { ...defaultProfile, onboarded: true });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("status")) return Response.json(statusBody());
      if (url.includes("places/reverse"))
        return Response.json({ error: "Kakao reverse down" }, { status: 503 });
      if (url.includes("places?"))
        return Response.json({ error: "Kakao search down" }, { status: 503 });
      return Response.json({});
    });

    render(<MemoryRouter initialEntries={["/real/home"]}><RealApp /></MemoryRouter>);
    const origin = await screen.findByRole("combobox", { name: "출발지" });
    fireEvent.change(origin, { target: { value: "없는 장소" } });
    await screen.findByText(/Kakao search down/);
    fireEvent.click(screen.getByRole("button", { name: "출발점 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "mock map pick" }));
    await waitFor(() =>
      expect((origin as HTMLInputElement).value).toBe("지도에서 선택한 위치"),
    );
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
