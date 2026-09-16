import { meters, validCoord, type Coord, type Fix } from "./core.ts";

export const LOCATION_ACCURACY = {
  GOOD_MAX_METERS: 30,
  USABLE_MAX_METERS: 80,
  POOR_MAX_METERS: 200,
  MAX_FIX_AGE_MS: 30_000,
  COLLECTION_MS: 12_000,
  STABLE_RADIUS_METERS: 20,
  MAX_RUNNING_SPEED_MPS: 10,
} as const;

export type LocationQuality = "good" | "usable" | "poor" | "unreliable";
export type PositioningMode =
  | "browser-geolocation"
  | "browser-filtered"
  | "urban-context"
  | "native-raw-gnss"
  | "native-shadow-matching"
  | "multipath-map-corrected"
  | "manual-map";

export type StartLocationSource =
  | "gps"
  | "browser-filtered"
  | "urban-context"
  | "manual-map"
  | "place-search"
  | "saved";

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
  source:
    | "browser-geolocation"
    | "browser-filtered"
    | "urban-context"
    | "manual-map"
    | "place-search";
};

export type MultipathCorrectionAvailability = {
  rawGnssAvailable: boolean;
  ephemerisAvailable: boolean;
  dgnssAvailable: boolean;
  skyModelAvailable: boolean;
  multipathMapAvailable: boolean;
  observationMatrixAvailable: boolean;
};

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

export function hasNativeMultipathInputs(
  availability: MultipathCorrectionAvailability,
) {
  return (
    availability.rawGnssAvailable &&
    availability.ephemerisAvailable &&
    availability.dgnssAvailable &&
    availability.skyModelAvailable &&
    availability.observationMatrixAvailable &&
    availability.multipathMapAvailable
  );
}

export function validLocationFix(fix: Fix, now = Date.now()) {
  return (
    validCoord(fix.coord) &&
    classifyLocationAccuracy(fix.accuracy) !== "unreliable" &&
    isFreshLocationFix(fix, now)
  );
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
    source:
      corrected.source === "native-raw-gnss" ||
      corrected.source === "native-shadow-matching" ||
      corrected.source === "multipath-map-corrected"
        ? "browser-filtered"
        : corrected.source,
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
