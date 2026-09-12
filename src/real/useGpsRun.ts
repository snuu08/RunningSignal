import { useEffect, useRef, useState } from "react";
import { appendFix, meters, type Fix, type Route, type Track } from "./core.ts";

const START_ACCURACY_MAX_M = 80;
const START_DEPARTURE_RADIUS_M = 100;
const START_SAMPLE_WINDOW_MS = 2500;
const START_SAMPLE_TARGET = 5;

export type LiveRun = {
  id: string;
  startedAt: number;
  phase: "running" | "paused" | "ended";
  track: Track;
  activeSec: number;
  manualPauseSec: number;
  lastTick: number;
  route: Route | null;
};

function toFix(p: GeolocationPosition): Fix {
  return {
    coord: [p.coords.longitude, p.coords.latitude],
    accuracy: p.coords.accuracy,
    at: p.timestamp,
    heading: (() => {
      const h = p.coords.heading;
      return h != null && Number.isFinite(h) && h >= 0 ? h : undefined;
    })(),
  };
}

export function locate(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("이 브라우저는 위치 기록을 지원하지 않습니다."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(toFix(p)),
      (e) =>
        reject(
          new Error(
            e.code === 1
              ? "위치 권한을 허용해 주세요. 지도에서 출발지를 고를 수도 있어요."
              : "현재 위치를 찾지 못했습니다. 야외에서 다시 시도하거나 지도에서 출발지를 고르세요.",
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}

function startupCluster(samples: Fix[]): Fix {
  const usable = samples.filter(
    (f) =>
      Number.isFinite(f.coord[0]) &&
      Number.isFinite(f.coord[1]) &&
      Number.isFinite(f.accuracy) &&
      f.accuracy >= 0 &&
      f.accuracy <= START_ACCURACY_MAX_M,
  );
  if (usable.length === 0) return samples[0];
  const best = usable
    .map((fix) => {
      const neighbors = usable.filter(
        (other) =>
          meters(fix.coord, other.coord) <=
          Math.max(35, Math.min(120, (fix.accuracy + other.accuracy) / 2 + 20)),
      );
      return { fix, neighbors };
    })
    .sort(
      (a, b) =>
        b.neighbors.length - a.neighbors.length ||
        a.fix.accuracy - b.fix.accuracy,
    )[0];
  const neighbors = best.neighbors.length ? best.neighbors : [best.fix];
  let weightSum = 0,
    lon = 0,
    lat = 0;
  for (const f of neighbors) {
    const weight = 1 / Math.max(5, f.accuracy) ** 2;
    weightSum += weight;
    lon += f.coord[0] * weight;
    lat += f.coord[1] * weight;
  }
  const coord: Fix["coord"] = [lon / weightSum, lat / weightSum];
  const spread = Math.max(0, ...neighbors.map((f) => meters(coord, f.coord)));
  return {
    coord,
    accuracy: Math.max(Math.min(...neighbors.map((f) => f.accuracy)), spread),
    at: Math.max(...neighbors.map((f) => f.at)),
    heading: best.fix.heading,
  };
}

function collectStartupFixes(first: Fix): Promise<Fix[]> {
  if (!navigator.geolocation?.watchPosition) return Promise.resolve([first]);
  return new Promise((resolve) => {
    const samples = [first];
    let watchId: number | null = null,
      shouldClearWatch = false,
      finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      else shouldClearWatch = true;
      clearTimeout(timer);
      resolve(samples);
    };
    const timer = window.setTimeout(done, START_SAMPLE_WINDOW_MS);
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        samples.push(toFix(p));
        if (samples.length >= START_SAMPLE_TARGET) done();
      },
      () => {
        if (samples.length > 1) done();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
    if (shouldClearWatch) navigator.geolocation.clearWatch(watchId);
  });
}

async function locateForStart(route: Route | null): Promise<Fix> {
  const first = await locate();
  const departure = route?.coordinates[0];
  if (!departure) {
    if (first.accuracy > 30)
      throw new Error(
        "GPS 오차가 30m보다 큽니다. 위치가 안정되면 다시 시작해 주세요.",
      );
    return first;
  }
  const firstDistance = meters(first.coord, departure);
  if (first.accuracy <= 30 && firstDistance <= START_DEPARTURE_RADIUS_M)
    return first;
  if (
    first.accuracy <= 30 &&
    firstDistance > START_DEPARTURE_RADIUS_M + START_ACCURACY_MAX_M
  )
    throw new Error(
      "설정한 출발지 100m 이내에서 시작해 주세요. 현재 위치로 경로를 다시 찾을 수도 있어요.",
    );
  const corrected = startupCluster(await collectStartupFixes(first));
  if (corrected.accuracy > START_ACCURACY_MAX_M)
    throw new Error(
      "GPS 오차가 커서 출발지를 확인하지 못했습니다. 위치가 안정되면 다시 시작해 주세요.",
    );
  const correctedDistance = meters(corrected.coord, departure);
  if (
    correctedDistance - Math.min(corrected.accuracy, START_ACCURACY_MAX_M) >
    START_DEPARTURE_RADIUS_M
  )
    throw new Error(
      "설정한 출발지 100m 이내에서 시작해 주세요. 현재 위치로 경로를 다시 찾을 수도 있어요.",
    );
  return corrected;
}

export function useGpsRun(onCheckpoint: (run: LiveRun) => void) {
  const [live, setLive] = useState<LiveRun | null>(null),
    [fix, setFix] = useState<Fix | null>(null),
    [error, setError] = useState("");
  const skipNext = useRef(false);
  const ref = useRef(live),
    save = useRef(onCheckpoint);
  save.current = onCheckpoint;
  const replace = (value: LiveRun | null) => {
    ref.current = value;
    setLive(value);
  };
  function tick(now = Date.now()): LiveRun | null {
    const r = ref.current;
    if (!r || r.phase === "ended") return r;
    const dt = Math.max(0, (now - r.lastTick) / 1000);
    const next = {
      ...r,
      activeSec: r.activeSec + (r.phase === "running" ? dt : 0),
      manualPauseSec: r.manualPauseSec + (r.phase === "paused" ? dt : 0),
      lastTick: now,
    };
    replace(next);
    return next;
  }
  useEffect(() => {
    const timer = setInterval(() => {
      const r = tick();
      if (r && r.phase !== "ended") save.current(r);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const phase = live?.phase;
  useEffect(() => {
    if (phase !== "running" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const next: Fix = {
          coord: [p.coords.longitude, p.coords.latitude],
          accuracy: p.coords.accuracy,
          at: p.timestamp,
          heading: (() => {
            const h = p.coords.heading;
            return h != null && Number.isFinite(h) && h >= 0 ? h : undefined;
          })(),
        };
        setFix(next);
        const r = ref.current;
        if (!r || r.phase !== "running") return;
        if (next.accuracy > 30) {
          setError("GPS 정확도가 낮아 이 위치는 거리에 더하지 않았어요.");
          return;
        }
        setError("");
        if (skipNext.current) {
          next.segmentStart = true;
          skipNext.current = false;
        }
        replace({ ...r, track: appendFix(r.track, next) });
      },
      (e) =>
        setError(
          e.code === 1
            ? "위치 권한이 해제됐어요. 기록을 일시정지하고 권한을 확인해 주세요."
            : "위치 수신이 끊겼어요. 수신하지 못한 구간은 거리에 더하지 않아요.",
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [phase]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden && ref.current?.phase === "running")
        setError(
          "화면을 벗어나면 GPS 수신이 중단될 수 있어요. 돌아온 뒤 위치 수신 상태를 확인해 주세요.",
        );
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (ref.current && ref.current.phase !== "ended") {
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  return {
    live,
    fix,
    error,
    async start(route: Route | null) {
      if (ref.current && ref.current.phase !== "ended")
        throw new Error("진행 중인 러닝을 먼저 종료해 주세요.");
      skipNext.current = false;
      const f = await locateForStart(route);
      setFix(f);
      const now = Date.now();
      replace({
        id: crypto.randomUUID(),
        startedAt: now,
        phase: "running",
        track: { fixes: [f], distanceM: 0, gapSec: 0, stoppedSec: 0 },
        activeSec: 0,
        manualPauseSec: 0,
        lastTick: now,
        route,
      });
    },
    pause() {
      const r = tick();
      if (r?.phase === "running") replace({ ...r, phase: "paused" });
    },
    resume() {
      const r = tick();
      if (r?.phase !== "paused") return;
      // Mark discontinuity so the next fix never adds movement during manual pause.
      skipNext.current = true;
      replace({ ...r, phase: "running" });
    },
    end() {
      const r = tick();
      if (!r) return null;
      const ended = { ...r, phase: "ended" as const };
      replace(ended);
      return ended;
    },
    updateRoute(route: Route) {
      const r = ref.current;
      if (!r || r.phase === "ended") return;
      replace({ ...r, route });
    },
    recover(r: LiveRun) {
      // Time while the app was closed is unrecorded, not claimed as running.
      skipNext.current = true;
      replace({
        ...r,
        phase: "paused",
        manualPauseSec:
          r.manualPauseSec + Math.max(0, (Date.now() - r.lastTick) / 1000),
        lastTick: Date.now(),
      });
    },
    clear() {
      replace(null);
    },
  };
}
