import { useEffect, useRef, useState } from "react";
import { appendFix, meters, type Fix, type Route, type Track } from "./core.ts";
import {
  classifyLocationAccuracy,
  correctedBrowserLocation,
  correctedLocationToFix,
  distinctLocationFixes,
  displayLocationForRoute,
  displayLocationFromFix,
  filterLocationOutliers,
  geolocationErrorReason,
  isFreshLocationFix,
  LOCATION_ACCURACY,
  LocationAcquisitionError,
  locationAcquisitionFromFixes,
  locationFailureUserMessage,
  locationSamplesFailureReason,
  normalizeGeolocationPosition,
  queryGeolocationPermission,
  validateDisplayFix,
  validateFix,
  type LocationAcquisitionResult,
  type RouteProjection,
} from "./location-quality.ts";

const GPS_SETTLE_MS = LOCATION_ACCURACY.COLLECTION_MS;
const GPS_STABLE_RADIUS_M = LOCATION_ACCURACY.STABLE_RADIUS_METERS;
const DISPLAY_SETTLE_MS = 10_000;
const DISPLAY_MAXIMUM_AGE_MS = 60_000;

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
export function locate(): Promise<Fix> {
  return acquireLocation().then((result) => result.fix);
}

function geolocationAvailableInThisContext() {
  if (typeof navigator === "undefined" || !("geolocation" in navigator))
    return false;
  if (typeof window === "undefined") return true;
  if (window.isSecureContext) return true;
  return ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}

export async function acquireLocation(options: {
  purpose?: "display" | "running";
  onUpdate?: (result: LocationAcquisitionResult) => void;
} = {}): Promise<LocationAcquisitionResult> {
  const purpose = options.purpose ?? "running";
  const permission = await queryGeolocationPermission();
  geolocationDebug("request-start", { purpose, permission });
  return new Promise((resolve, reject) => {
    if (!geolocationAvailableInThisContext()) {
      const reason =
        typeof navigator === "undefined" || !("geolocation" in navigator)
          ? "unsupported"
          : "secure-context";
      reject(new LocationAcquisitionError(reason));
      return;
    }
    if (permission === "denied") {
      geolocationDebug("request-blocked", { purpose, permission });
      reject(new LocationAcquisitionError("permission-denied"));
      return;
    }
    const samples: Fix[] = [];
    let settled = false;
    let watchId: number | null = null;
    let timer = 0;
    let lastFailure: LocationAcquisitionError | null = null;
    const finish = (
      result: LocationAcquisitionResult | null,
      error?: LocationAcquisitionError,
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (result) resolve(result);
      else
        reject(
          error ??
            new LocationAcquisitionError(
              locationSamplesFailureReason(samples),
            ),
        );
    };
    const receive = (p: GeolocationPosition) => {
      const validation =
        purpose === "display"
          ? validateDisplayFix(normalizeGeolocationPosition(p))
          : validateFix(normalizeGeolocationPosition(p));
      if (!validation.ok) {
        geolocationDebug("fix-rejected", {
          purpose,
          reason: validation.reason,
          accuracy: normalizeGeolocationPosition(p).accuracy,
        });
        lastFailure = new LocationAcquisitionError(
          validation.reason,
          locationFailureUserMessage(validation.reason),
          validation.developerMessage,
        );
        return;
      }
      const nextSamples = distinctGpsFixes([...samples, validation.fix]);
      samples.splice(0, samples.length, ...nextSamples);
      if (purpose === "display") {
        const result = displayLocationFromFix(validation.fix, permission);
        geolocationDebug("display-accepted", {
          accuracy: result.fix.accuracy,
          longitude: result.fix.coord[0],
          latitude: result.fix.coord[1],
        });
        options.onUpdate?.(result);
        const best = samples.reduce(
          (picked, item) => (item.accuracy < picked.accuracy ? item : picked),
          validation.fix,
        );
        if (samples.length >= 2 && best.accuracy <= 30)
          finish(displayLocationFromFix(best, permission));
        return;
      }
      const result = locationAcquisitionFromFixes(
        samples,
        Date.now(),
        permission,
      );
      const sampleSpan = samples.length
        ? Math.max(...samples.map((sample) => sample.at)) -
          Math.min(...samples.map((sample) => sample.at))
        : 0;
      if (
        result &&
        ((samples.length === 1 &&
          result.quality === "good" &&
          result.fix.accuracy <= 10) ||
          (samples.length >= 3 &&
            sampleSpan >= 1_500 &&
            (result.quality === "good" || result.quality === "usable")))
      )
        finish(result);
    };
    const fail = (e: GeolocationPositionError) => {
      const reason = geolocationErrorReason(e);
      geolocationDebug("request-failed", { purpose, code: e.code, reason });
      const error = new LocationAcquisitionError(
        reason,
        locationFailureUserMessage(reason),
        e.message,
      );
      if (reason === "permission-denied") finish(null, error);
      else lastFailure = error;
    };
    timer = window.setTimeout(
      () =>
        finish(
          purpose === "display" && samples.length
            ? displayLocationFromFix(
                samples.reduce((picked, item) =>
                  item.accuracy < picked.accuracy ? item : picked,
                ),
                permission,
              )
            : locationAcquisitionFromFixes(samples, Date.now(), permission),
          samples.length
            ? new LocationAcquisitionError(locationSamplesFailureReason(samples))
            : (lastFailure ?? new LocationAcquisitionError("timeout")),
        ),
      purpose === "display" ? DISPLAY_SETTLE_MS : GPS_SETTLE_MS,
    );
    const watchOptions: PositionOptions =
      purpose === "display"
        ? {
            enableHighAccuracy: true,
            maximumAge: 5_000,
            timeout: DISPLAY_SETTLE_MS,
          }
        : { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 };
    const currentOptions: PositionOptions =
      purpose === "display"
        ? {
            enableHighAccuracy: false,
            maximumAge: DISPLAY_MAXIMUM_AGE_MS,
            timeout: DISPLAY_SETTLE_MS,
          }
        : {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: GPS_SETTLE_MS,
          };
    const id = navigator.geolocation.watchPosition(
      receive,
      fail,
      watchOptions,
    );
    watchId = id;
    if (settled) {
      navigator.geolocation.clearWatch(id);
      return;
    }
    navigator.geolocation.getCurrentPosition(receive, fail, currentOptions);
  });
}
export function useGpsRun(onCheckpoint: (run: LiveRun) => void) {
  const [live, setLive] = useState<LiveRun | null>(null),
    [fix, setFix] = useState<Fix | null>(null),
    [rawFix, setRawFix] = useState<Fix | null>(null),
    [routeProjection, setRouteProjection] = useState<RouteProjection | null>(null),
    [error, setError] = useState("");
  const skipNext = useRef(false);
  const watchSamples = useRef<Fix[]>([]);
  const routeProgressM = useRef<number | null>(null);
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
        const r = ref.current;
        if (!r || r.phase !== "running") return;
        const validation = validateFix(normalizeGeolocationPosition(p));
        if (!validation.ok) {
          setError(locationFailureUserMessage(validation.reason));
          return;
        }
        const raw = validation.fix;
        const samples = distinctGpsFixes([...watchSamples.current, raw]).slice(-8);
        const filtered = filterLocationOutliers(samples);
        const accepted = filtered.at(-1);
        watchSamples.current = filtered.slice(-8);
        if (!accepted || accepted.at !== raw.at) {
          setError(
            "GPS 위치가 갑자기 튀어 이번 샘플은 기록 거리에서 제외했습니다.",
          );
          return;
        }
        const projected = displayLocationForRoute(
          accepted,
          r.route,
          routeProgressM.current,
        );
        routeProgressM.current = projected.routeProjection?.traveledM ?? null;
        const next = { ...projected.recordingFix };
        setRawFix(projected.rawFix);
        setFix(projected.displayFix);
        setRouteProjection(projected.routeProjection);
        const quality = classifyLocationAccuracy(next.accuracy);
        if (quality === "poor")
          setError("GPS 위치가 불안정해 지도 표시에만 참고하고 거리는 보수적으로 계산합니다.");
        else if (quality === "usable")
          setError("GPS 오차가 다소 있어 안정적인 움직임만 거리에 반영합니다.");
        else if (quality === "unreliable")
          setError("현재 GPS 위치를 신뢰하기 어려워 거리 계산에서 제외했습니다.");
        else setError("");
        if (skipNext.current) {
          next.segmentStart = true;
          skipNext.current = false;
        }
        replace({ ...r, track: appendFix(r.track, next) });
      },
      (e) =>
        setError(
          geolocationErrorReason(e) === "permission-denied"
            ? "위치 권한이 해제됐어요. 기록을 일시정지하고 권한을 확인해 주세요."
            : locationFailureUserMessage(geolocationErrorReason(e)),
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
    rawFix,
    routeProjection,
    error,
    async start(route: Route | null, expectedStart?: Fix["coord"] | null) {
      if (ref.current && ref.current.phase !== "ended")
        throw new Error("진행 중인 러닝을 먼저 종료해 주세요.");
      skipNext.current = false;
      watchSamples.current = [];
      const departure = expectedStart ?? route?.coordinates[0];
      const acquired = await acquireLocation();
      const f = acquired.fix;
      if (acquired.quality === "unreliable")
        throw new Error(
          "현재 위치를 정확하게 확인하기 어렵습니다. 다시 측정하거나 지도에서 출발지를 선택해 주세요.",
        );
      if (
        departure &&
        meters(f.coord, departure) -
          startDistanceAccuracyCredit(acquired.quality, f.accuracy) >
          100
      )
        throw new Error(
          "설정한 출발지 100m 이내에서 시작해 주세요. 현재 위치로 경로를 다시 찾을 수도 있어요.",
        );
      if (acquired.quality === "usable")
        setError(
          `현재 위치 오차 범위가 약 ${Math.round(f.accuracy)}m입니다. 선택한 출발지를 기준으로 기록을 시작합니다.`,
        );
      else if (acquired.quality === "poor")
        setError(
          `주변 환경으로 인해 위치가 불안정합니다. 약 ${Math.round(f.accuracy)}m 범위의 후보 위치로 시작하므로 지도에서 출발지를 확인해 주세요.`,
        );
      else setError("");
      const projected = displayLocationForRoute(f, route);
      routeProgressM.current = projected.routeProjection?.traveledM ?? null;
      setRawFix(projected.rawFix);
      setFix(projected.displayFix);
      setRouteProjection(projected.routeProjection);
      watchSamples.current = [projected.recordingFix];
      const now = Date.now();
      replace({
        id: crypto.randomUUID(),
        startedAt: now,
        phase: "running",
        track: { fixes: [projected.recordingFix], distanceM: 0, gapSec: 0, stoppedSec: 0 },
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
      routeProgressM.current = null;
      const current = rawFix ?? fix;
      if (current) {
        const projected = displayLocationForRoute(current, route);
        setFix(projected.displayFix);
        setRouteProjection(projected.routeProjection);
        routeProgressM.current = projected.routeProjection?.traveledM ?? null;
      }
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
      setFix(null);
      setRawFix(null);
      setRouteProjection(null);
      watchSamples.current = [];
      routeProgressM.current = null;
    },
  };
}

function geolocationDebug(event: string, detail: Record<string, unknown>) {
  if (typeof import.meta !== "undefined" && import.meta.env.DEV)
    console.debug("[gps]", event, detail);
}

function startDistanceAccuracyCredit(
  quality: LocationAcquisitionResult["quality"],
  accuracyM: number,
) {
  const cap = quality === "good" ? 20 : quality === "usable" ? 35 : 45;
  return Math.min(accuracyM, cap);
}
