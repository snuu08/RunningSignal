import {
  meters,
  progressOnRoute,
  validCoord,
  type Coord,
  type Fix,
  type Route,
} from "./core.ts";

export const LOCATION_ACCURACY = {
  GOOD_MAX_METERS: 30,
  USABLE_MAX_METERS: 80,
  POOR_MAX_METERS: 200,
  MAX_FIX_AGE_MS: 30_000,
  COLLECTION_MS: 12_000,
  STABLE_RADIUS_METERS: 20,
  MAX_RUNNING_SPEED_MPS: 10,
  ROUTE_PROJECTION_MIN_METERS: 45,
  ROUTE_PROJECTION_MARGIN_METERS: 20,
} as const;

export type LocationQuality = "good" | "usable" | "poor" | "unreliable";
export type PositioningMode = "browser-geolocation" | "browser-filtered";

export type StartLocationSource =
  | "gps"
  | "browser-filtered"
  | "manual-map"
  | "place-search"
  | "saved";

export type LocationFailureReason =
  | "unsupported"
  | "permission-denied"
  | "position-unavailable"
  | "timeout"
  | "secure-context"
  | "inaccurate"
  | "insufficient-samples"
  | "stale"
  | "unknown";

export type LocationPermissionState =
  | "granted"
  | "prompt"
  | "denied"
  | "unsupported"
  | "unknown";

export type LocationSample = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
};

export type CorrectedLocation = {
  latitude: number;
  longitude: number;
  reportedAccuracyMeters: number | null;
  confidence: number;
  source: PositioningMode;
  timestamp: number;
  requiresConfirmation: boolean;
  rawLocation?: LocationSample;
};

export type LocationAcquisitionResult = {
  fix: Fix;
  quality: LocationQuality;
  confidence: number;
  clusterSpreadMeters: number;
  rawSamples: Fix[];
  requiresConfirmation: boolean;
  source: PositioningMode;
  permission: LocationPermissionState;
};

export class LocationAcquisitionError extends Error {
  readonly reason: LocationFailureReason;
  readonly userMessage: string;
  readonly developerMessage: string;

  constructor(
    reason: LocationFailureReason,
    userMessage = locationFailureUserMessage(reason),
    developerMessage = userMessage,
  ) {
    super(userMessage);
    this.name = "LocationAcquisitionError";
    this.reason = reason;
    this.userMessage = userMessage;
    this.developerMessage = developerMessage;
  }
}

export function locationFailureUserMessage(
  reason: LocationFailureReason,
): string {
  switch (reason) {
    case "unsupported":
      return "이 브라우저는 위치 기록을 지원하지 않습니다.";
    case "permission-denied":
      return "위치 권한이 꺼져 있습니다. 브라우저 설정에서 허용하거나 지도에서 출발지를 직접 선택하세요.";
    case "position-unavailable":
      return "현재 위치 신호를 받을 수 없습니다. 야외에서 다시 시도하거나 지도에서 출발지를 선택하세요.";
    case "timeout":
      return "현재 위치 확인 시간이 초과됐습니다. 다시 측정하거나 지도에서 출발지를 선택하세요.";
    case "secure-context":
      return "위치 기능은 HTTPS 또는 localhost 같은 보안 연결에서만 사용할 수 있습니다.";
    case "inaccurate":
      return "GPS 오차가 너무 큽니다. 위치 다시 측정 또는 지도에서 출발지 선택을 사용하세요.";
    case "insufficient-samples":
      return "현재 위치 샘플이 부족합니다. 잠시 멈춰서 다시 측정해 주세요.";
    case "stale":
      return "오래된 위치만 수신했습니다. 현재 위치를 다시 측정해 주세요.";
    case "unknown":
    default:
      return "현재 위치를 확인하지 못했습니다. 다시 측정하거나 지도에서 출발지를 선택해 주세요.";
  }
}

export function geolocationErrorReason(
  error: Pick<GeolocationPositionError, "code">,
): LocationFailureReason {
  switch (error.code) {
    case 1:
      return "permission-denied";
    case 2:
      return "position-unavailable";
    case 3:
      return "timeout";
    default:
      return "unknown";
  }
}

export async function queryGeolocationPermission(): Promise<LocationPermissionState> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator))
    return "unsupported";
  const permissions = navigator.permissions;
  if (!permissions?.query) return "unknown";
  try {
    const status = await permissions.query({
      name: "geolocation" as PermissionName,
    });
    if (
      status.state === "granted" ||
      status.state === "prompt" ||
      status.state === "denied"
    )
      return status.state;
  } catch {
    return "unknown";
  }
  return "unknown";
}

export function classifyLocationAccuracy(accuracy: number): LocationQuality {
  if (!Number.isFinite(accuracy) || accuracy <= 0) return "unreliable";
  if (accuracy <= LOCATION_ACCURACY.GOOD_MAX_METERS) return "good";
  if (accuracy <= LOCATION_ACCURACY.USABLE_MAX_METERS) return "usable";
  if (accuracy <= LOCATION_ACCURACY.POOR_MAX_METERS) return "poor";
  return "unreliable";
}

export function isFreshLocationFix(
  fix: Pick<Fix, "at">,
  now = Date.now(),
  maxAgeMs = LOCATION_ACCURACY.MAX_FIX_AGE_MS,
) {
  return Number.isFinite(fix.at) && Math.abs(now - fix.at) <= maxAgeMs;
}

export function bestAccuracyFix<T extends Pick<Fix, "accuracy" | "at">>(
  fixes: T[],
): T | null {
  const usable = fixes.filter(
    (fix) =>
      classifyLocationAccuracy(fix.accuracy) !== "unreliable" &&
      Number.isFinite(fix.at),
  );
  if (!usable.length) return null;
  return [...usable].sort((a, b) => {
    const accuracy = a.accuracy - b.accuracy;
    if (accuracy !== 0) return accuracy;
    return b.at - a.at;
  })[0];
}

export function fixToLocationSample(fix: Fix): LocationSample {
  return {
    latitude: fix.coord[1],
    longitude: fix.coord[0],
    accuracy: fix.accuracy,
    altitude: null,
    speed: null,
    heading: fix.heading ?? null,
    timestamp: fix.at,
  };
}

export function locationSampleToFix(sample: LocationSample): Fix {
  return {
    coord: [sample.longitude, sample.latitude],
    accuracy: sample.accuracy,
    at: sample.timestamp,
    heading:
      sample.heading != null && Number.isFinite(sample.heading) && sample.heading >= 0
        ? sample.heading
        : undefined,
  };
}

export type FixValidation =
  | { ok: true; fix: Fix }
  | {
      ok: false;
      reason: LocationFailureReason;
      developerMessage: string;
    };

export function normalizeGeolocationPosition(
  position: GeolocationPosition,
): Fix {
  const heading = position.coords.heading;
  return {
    coord: [position.coords.longitude, position.coords.latitude],
    accuracy: position.coords.accuracy,
    at: position.timestamp,
    heading:
      heading != null && Number.isFinite(heading) && heading >= 0
        ? heading
        : undefined,
  };
}

export function validateFix(fix: Fix, now = Date.now()): FixValidation {
  if (!validCoord(fix.coord))
    return {
      ok: false,
      reason: "unknown",
      developerMessage: "Invalid or non-finite WGS84 coordinate.",
    };
  if (!Number.isFinite(fix.at))
    return {
      ok: false,
      reason: "unknown",
      developerMessage: "Geolocation timestamp is not finite.",
    };
  if (!isFreshLocationFix(fix, now))
    return {
      ok: false,
      reason: "stale",
      developerMessage: `Geolocation fix is older than ${LOCATION_ACCURACY.MAX_FIX_AGE_MS}ms.`,
    };
  if (
    !Number.isFinite(fix.accuracy) ||
    fix.accuracy <= 0 ||
    fix.accuracy > LOCATION_ACCURACY.POOR_MAX_METERS
  )
    return {
      ok: false,
      reason: "inaccurate",
      developerMessage: `Geolocation accuracy ${fix.accuracy}m is outside the accepted range.`,
    };
  return { ok: true, fix };
}

export function locationSamplesFailureReason(
  fixes: Fix[],
  now = Date.now(),
): LocationFailureReason {
  if (!fixes.length) return "insufficient-samples";
  if (fixes.every((fix) => validCoord(fix.coord) && !isFreshLocationFix(fix, now)))
    return "stale";
  if (
    fixes.every(
      (fix) =>
        !Number.isFinite(fix.accuracy) ||
        fix.accuracy <= 0 ||
        fix.accuracy > LOCATION_ACCURACY.POOR_MAX_METERS,
    )
  )
    return "inaccurate";
  return "insufficient-samples";
}

export function validLocationFix(fix: Fix, now = Date.now()) {
  return validateFix(fix, now).ok;
}

export function distinctLocationFixes(fixes: Fix[]): Fix[] {
  return [...fixes]
    .sort((a, b) => a.at - b.at)
    .reduce<Fix[]>((result, fix) => {
      const duplicate = result.findIndex(
        (item) =>
          item.at === fix.at ||
          (Math.abs(item.at - fix.at) < 500 && meters(item.coord, fix.coord) < 1),
      );
      if (duplicate < 0) result.push(fix);
      else if (fix.accuracy < result[duplicate].accuracy)
        result[duplicate] = fix;
      return result;
    }, []);
}

export function plausibleFromPrevious(prev: Fix, next: Fix) {
  const dt = (next.at - prev.at) / 1000;
  if (dt <= 0) return false;
  const allowed =
    LOCATION_ACCURACY.MAX_RUNNING_SPEED_MPS * dt +
    Math.min(prev.accuracy, LOCATION_ACCURACY.USABLE_MAX_METERS) +
    Math.min(next.accuracy, LOCATION_ACCURACY.USABLE_MAX_METERS) +
    20;
  return meters(prev.coord, next.coord) <= allowed;
}

export function filterLocationOutliers(fixes: Fix[], now = Date.now()): Fix[] {
  const valid = distinctLocationFixes(fixes).filter((fix) =>
    validLocationFix(fix, now),
  );
  const accepted: Fix[] = [];
  for (const fix of valid) {
    const prev = accepted.at(-1);
    if (!prev || plausibleFromPrevious(prev, fix)) {
      accepted.push(fix);
      continue;
    }
    const best = bestAccuracyFix(accepted);
    if (
      best &&
      meters(best.coord, fix.coord) <=
        Math.max(
          LOCATION_ACCURACY.STABLE_RADIUS_METERS,
          Math.min(fix.accuracy, LOCATION_ACCURACY.USABLE_MAX_METERS),
        )
    )
      accepted.push(fix);
  }
  return accepted.length ? accepted : valid.slice(0, 1);
}

function weightedCenter(fixes: Fix[]): Coord {
  const weighted = fixes.map((fix) => ({
    fix,
    weight: 1 / Math.max(5, fix.accuracy) ** 2,
  }));
  const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0);
  return [
    weighted.reduce((sum, item) => sum + item.fix.coord[0] * item.weight, 0) /
      weightSum,
    weighted.reduce((sum, item) => sum + item.fix.coord[1] * item.weight, 0) /
      weightSum,
  ];
}

export function correctedBrowserLocation(
  fixes: Fix[],
  now = Date.now(),
): CorrectedLocation | null {
  const filtered = filterLocationOutliers(fixes, now);
  if (!filtered.length) return null;
  const medoid = [...filtered].sort((a, b) => {
    const da = filtered.reduce((sum, item) => sum + meters(a.coord, item.coord), 0);
    const db = filtered.reduce((sum, item) => sum + meters(b.coord, item.coord), 0);
    return da - db;
  })[0];
  const cluster = filtered.filter(
    (fix) =>
      meters(medoid.coord, fix.coord) <=
      Math.max(
        LOCATION_ACCURACY.STABLE_RADIUS_METERS,
        Math.min(fix.accuracy, LOCATION_ACCURACY.USABLE_MAX_METERS),
      ),
  );
  const usable = cluster.length ? cluster : [medoid];
  const coord = weightedCenter(usable);
  const spread = Math.max(...usable.map((fix) => meters(coord, fix.coord)), 0);
  const reportedAccuracyMeters = Math.max(
    Math.min(...usable.map((fix) => fix.accuracy)),
    spread,
  );
  const quality = classifyLocationAccuracy(reportedAccuracyMeters);
  const sampleConfidence = Math.min(1, usable.length / 4);
  const accuracyConfidence =
    quality === "good" ? 1 : quality === "usable" ? 0.72 : quality === "poor" ? 0.35 : 0;
  const spreadConfidence =
    spread <= LOCATION_ACCURACY.STABLE_RADIUS_METERS
      ? 1
      : Math.max(0.2, 1 - spread / LOCATION_ACCURACY.POOR_MAX_METERS);
  const best = bestAccuracyFix(usable);
  return {
    longitude: coord[0],
    latitude: coord[1],
    reportedAccuracyMeters,
    confidence: Math.max(
      0,
      Math.min(1, accuracyConfidence * 0.55 + sampleConfidence * 0.25 + spreadConfidence * 0.2),
    ),
    source: usable.length >= 2 ? "browser-filtered" : "browser-geolocation",
    timestamp: Math.max(...usable.map((fix) => fix.at)),
    requiresConfirmation: quality !== "good",
    rawLocation: best ? fixToLocationSample(best) : undefined,
  };
}

export function locationAcquisitionFromFixes(
  fixes: Fix[],
  now = Date.now(),
  permission: LocationPermissionState = "unknown",
): LocationAcquisitionResult | null {
  const corrected = correctedBrowserLocation(fixes, now);
  if (!corrected) return null;
  const fix = correctedLocationToFix(corrected);
  const rawSamples = distinctLocationFixes(fixes).filter((sample) =>
    validLocationFix(sample, now),
  );
  const clusterSpreadMeters =
    rawSamples.length > 1
      ? Math.max(...rawSamples.map((sample) => meters(fix.coord, sample.coord)))
      : 0;
  return {
    fix,
    quality: classifyLocationAccuracy(fix.accuracy),
    confidence: corrected.confidence,
    clusterSpreadMeters,
    rawSamples,
    requiresConfirmation: corrected.requiresConfirmation,
    source: corrected.source,
    permission,
  };
}

export function correctedLocationToFix(location: CorrectedLocation): Fix {
  return {
    coord: [location.longitude, location.latitude],
    accuracy:
      location.reportedAccuracyMeters ?? LOCATION_ACCURACY.POOR_MAX_METERS,
    at: location.timestamp,
  };
}

export type RouteProjection = {
  coord: Coord;
  traveledM: number;
  remainM: number;
  offRouteM: number;
  totalM: number;
  thresholdM: number;
  usedForDisplay: boolean;
};

export type RouteDisplayLocation = {
  rawFix: Fix;
  recordingFix: Fix;
  displayFix: Fix;
  routeProjection: RouteProjection | null;
};

export function displayLocationForRoute(
  rawFix: Fix,
  route: Pick<Route, "coordinates"> | null | undefined,
): RouteDisplayLocation {
  if (!route?.coordinates?.length)
    return {
      rawFix,
      recordingFix: rawFix,
      displayFix: rawFix,
      routeProjection: null,
    };
  const progress = progressOnRoute(route.coordinates, rawFix.coord);
  const thresholdM = Math.max(
    rawFix.accuracy + LOCATION_ACCURACY.ROUTE_PROJECTION_MARGIN_METERS,
    LOCATION_ACCURACY.ROUTE_PROJECTION_MIN_METERS,
  );
  const canProject =
    classifyLocationAccuracy(rawFix.accuracy) !== "poor" &&
    classifyLocationAccuracy(rawFix.accuracy) !== "unreliable" &&
    progress.offRouteM <= thresholdM;
  const routeProjection: RouteProjection = {
    coord: progress.closestCoord,
    traveledM: progress.traveledM,
    remainM: progress.remainM,
    offRouteM: progress.offRouteM,
    totalM: progress.totalM,
    thresholdM,
    usedForDisplay: canProject,
  };
  return {
    rawFix,
    recordingFix: rawFix,
    displayFix: canProject ? { ...rawFix, coord: progress.closestCoord } : rawFix,
    routeProjection,
  };
}
