import { useEffect, useRef, useState } from "react";
import { appendFix, meters, type Fix, type Route, type Track } from "./core.ts";
import {
  classifyLocationAccuracy,
  correctedBrowserLocation,
  correctedLocationToFix,
  distinctLocationFixes,
  isFreshLocationFix,
  LOCATION_ACCURACY,
} from "./location-quality.ts";

const GPS_SETTLE_MS = LOCATION_ACCURACY.COLLECTION_MS;
const GPS_STABLE_RADIUS_M = 20;

export function stabilizedFix(
  fixes: Fix[],
  now = Date.now(),
): Fix | null {
  const corrected = correctedBrowserLocation(fixes, now);
  if (corrected) return correctedLocationToFix(corrected);
  const fresh = fixes.filter(
    (fix) =>
      Number.isFinite(fix.accuracy) &&
      fix.accuracy > 0 &&
      fix.accuracy <= LOCATION_ACCURACY.POOR_MAX_METERS &&
      isFreshLocationFix(fix, now),
  );
  if (!fresh.length) return null;
  const center = [...fresh].sort((a, b) => {
    const da = fresh.reduce((sum, item) => sum + meters(a.coord, item.coord), 0);
    const db = fresh.reduce((sum, item) => sum + meters(b.coord, item.coord), 0);
    return da - db;
  })[0];
  const clustered = fresh.filter(
    (fix) =>
      meters(center.coord, fix.coord) <=
      Math.max(GPS_STABLE_RADIUS_M, fix.accuracy),
  );
  const usable = clustered.length ? clustered : [center];
  const weighted = usable.map((fix) => ({
    fix,
    weight: 1 / Math.max(5, fix.accuracy) ** 2,
  }));
  const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0);
  const coord: Fix["coord"] = [
    weighted.reduce((sum, item) => sum + item.fix.coord[0] * item.weight, 0) /
      weightSum,
    weighted.reduce((sum, item) => sum + item.fix.coord[1] * item.weight, 0) /
      weightSum,
  ];
  const spread = Math.max(...usable.map((fix) => meters(coord, fix.coord)), 0);
  return {
    coord,
    accuracy: Math.max(
      Math.min(...usable.map((fix) => fix.accuracy)),
      spread,
    ),
    at: Math.max(...usable.map((fix) => fix.at)),
  };
}

export function distinctGpsFixes(fixes: Fix[]): Fix[] {
  return distinctLocationFixes(fixes);
}

export type LiveRun = {
  id: string;
  startedAt: number;
  phase: "running" | "paused" | "ended";
  track: Track;
  activeSec: number;
  manualPauseSec: number;
  lastTick: number;
  route: Route | null;
  /** User-selected departure, before a routing provider snaps it to a road. */
  departure?: Fix["coord"] | null;
};
export function locate(
  maxAcceptedAccuracyM: number = LOCATION_ACCURACY.GOOD_MAX_METERS,
): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("이 브라우저는 위치 기록을 지원하지 않습니다."));
      return;
    }
    const samples: Fix[] = [];
    let settled = false;
    let watchId: number | null = null;
    let timer = 0;
    let lastFailure: Error | null = null;
    const finish = (fix: Fix | null, error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (fix && fix.accuracy <= maxAcceptedAccuracyM) resolve(fix);
      else
        reject(
          error ??
            new Error(
              "GPS 오차가 30m보다 큽니다. 창가나 야외에서 위치가 안정되면 다시 시도해 주세요.",
            ),
        );
    };
    const receive = (p: GeolocationPosition) => {
      const nextSamples = distinctGpsFixes([...samples, {
        coord: [p.coords.longitude, p.coords.latitude],
        accuracy: p.coords.accuracy,
        at: p.timestamp,
      }]);
      samples.splice(0, samples.length, ...nextSamples);
      const fix = stabilizedFix(samples);
      const sampleSpan = samples.length
        ? Math.max(...samples.map((sample) => sample.at)) -
          Math.min(...samples.map((sample) => sample.at))
        : 0;
      if (
        fix &&
        ((samples.length === 1 && fix.accuracy <= 10) ||
          (samples.length >= 3 &&
            sampleSpan >= 1_500 &&
            fix.accuracy <= maxAcceptedAccuracyM))
      )
        finish(fix);
    };
    const fail = (e: GeolocationPositionError) => {
      const error = new Error(
        e.code === 1
          ? "위치 권한을 허용해 주세요. 지도에서 출발지를 고를 수도 있어요."
          : "현재 위치를 찾지 못했습니다. 야외에서 다시 시도하거나 지도에서 출발지를 고르세요.",
      );
      if (e.code === 1) finish(null, error);
      else lastFailure = error;
    };
    timer = window.setTimeout(
      () =>
        finish(
          stabilizedFix(samples),
          samples.length ? undefined : (lastFailure ?? undefined),
        ),
      GPS_SETTLE_MS,
    );
    const id = navigator.geolocation.watchPosition(
      receive,
      fail,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    watchId = id;
    if (settled) {
      navigator.geolocation.clearWatch(id);
      return;
    }
    navigator.geolocation.getCurrentPosition(receive, fail, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: GPS_SETTLE_MS,
    });
  });
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
        if (classifyLocationAccuracy(next.accuracy) !== "good") {
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
    async start(route: Route | null, expectedStart?: Fix["coord"] | null) {
      if (ref.current && ref.current.phase !== "ended")
        throw new Error("진행 중인 러닝을 먼저 종료해 주세요.");
      skipNext.current = false;
      const departure = expectedStart ?? route?.coordinates[0];
      const f = await locate(
        departure
          ? LOCATION_ACCURACY.USABLE_MAX_METERS
          : LOCATION_ACCURACY.GOOD_MAX_METERS,
      );
      if (!departure && classifyLocationAccuracy(f.accuracy) !== "good")
        throw new Error(
          "GPS 오차가 30m보다 큽니다. 위치가 안정되면 다시 시작해 주세요.",
        );
      if (
        departure &&
        meters(f.coord, departure) -
          Math.min(f.accuracy, LOCATION_ACCURACY.USABLE_MAX_METERS) >
          100
      )
        throw new Error(
          "설정한 출발지 100m 이내에서 시작해 주세요. 현재 위치로 경로를 다시 찾을 수도 있어요.",
        );
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
        departure: departure ?? null,
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
