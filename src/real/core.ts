import {
  allowedExtraMeters,
  TRIAL_ROUTING_POLICY,
  type RealRoutingPolicy,
} from "./routing-policy.ts";
import {
  CROSSING_BUFFER_SEC,
  CROSSING_WALK_M_PER_SEC,
} from "../config/app.ts";
import {
  ENGINE_PLAN_APPLIED_MAX_AGE_MS,
  ENGINE_PLAN_CLOCK_SKEW_MS,
} from "./signals/freshness.ts";

/** Real-world coordinates are always [longitude, latitude], WGS84. */
export type Coord = [number, number];
export type Place = {
  id: string;
  name: string;
  coord: Coord;
  address?: string;
};
export type NearbyPoi = {
  id: string;
  name: string;
  coord: Coord;
  atM: number;
  offPathM: number;
  source: "tmap-instruction" | "kakao-keyword";
};
export type Route = {
  id: string;
  name: string;
  coordinates: Coord[];
  distanceM: number;
  sharpTurns: number;
  zigzags: number;
  option: string;
  instructions: { coord: Coord; text: string }[];
  straightM?: number;
  extraM?: number;
  maxOffLineM?: number;
  nearbyPois?: NearbyPoi[];
  hasStairs?: boolean;
  hasOverpass?: boolean;
  hasAlley?: boolean;
  /** True when TMAP/Kakao text or facilityType was present. False means 회피 확인 불가. */
  facilityHints?: boolean;
};
export type FixedPlan = {
  cycleSec: number;
  epochMs: number;
  entryStartSec: number;
  entryEndSec: number;
  clearEndSec: number;
  validFromMs: number;
  validToMs: number;
  /** Engine freshness clock = currentPlanConfirmedAt, not fetchedAt. See signals/freshness.ts. */
  verifiedAtMs: number;
  uncertaintySec: number;
};
/** Runtime slice. Source model is src/real/signals/schema.ts. widthM is travel-direction length. */
export type Crossing = {
  id: string;
  name: string;
  atM: number;
  widthM: number;
  plan: FixedPlan | null;
};
export type Forecast = {
  waitSec: number | null;
  stops: number | null;
  maxWaitSec: number | null;
  totalSec: number | null;
  crossings: { id: string; arrivalMs: number | null; waitSec: number | null }[];
};
export type WalkingEmptyReason =
  | "none"
  | "walkable"
  | "stairs"
  | "overpass"
  | "detour";
export type AvoidanceCheck = {
  stairs: "off" | "tmap-option-30";
  overpass: "off" | "excluded" | "unconfirmed";
  alley: "off" | "preferred-wide" | "unconfirmed";
};
export function meters(a: Coord, b: Coord): number {
  const r = Math.PI / 180,
    dlat = (b[1] - a[1]) * r,
    dlon = (b[0] - a[0]) * r;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dlon / 2) ** 2;
  return (
    6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
  );
}
export function pathLength(points: Coord[]): number {
  return points.slice(1).reduce((s, p, i) => s + meters(points[i], p), 0);
}
/** Closest point on segment AB in a local tangent plane; meters stay WGS84. */
export function closestOnSegment(
  point: Coord,
  a: Coord,
  b: Coord,
): { coord: Coord; t: number; distM: number } {
  const scale = Math.cos((a[1] * Math.PI) / 180);
  const bx = (b[0] - a[0]) * scale,
    by = b[1] - a[1],
    px = (point[0] - a[0]) * scale,
    py = point[1] - a[1];
  const len2 = bx * bx + by * by;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const coord: Coord = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { coord, t, distM: meters(point, coord) };
}
export function maxOffLineM(points: Coord[], start: Coord, end: Coord): number {
  if (points.length < 2) return 0;
  return samplePath(points, 40).reduce(
    (m, p) => Math.max(m, closestOnSegment(p, start, end).distM),
    0,
  );
}
export function progressOnRoute(path: Coord[], here: Coord) {
  const totalM = pathLength(path);
  if (path.length < 2)
    return { traveledM: 0, remainM: 0, offRouteM: 0, totalM };
  let best = { dist: Infinity, i: 0, t: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const hit = closestOnSegment(here, path[i], path[i + 1]);
    if (hit.distM < best.dist) best = { dist: hit.distM, i: i, t: hit.t };
  }
  let traveledM = 0;
  for (let i = 0; i < best.i; i++) traveledM += meters(path[i], path[i + 1]);
  traveledM += meters(path[best.i], path[best.i + 1]) * best.t;
  return {
    traveledM,
    remainM: Math.max(0, totalM - traveledM),
    offRouteM: best.dist,
    totalM,
  };
}
export function withGeometry(route: Route): Route {
  const start = route.coordinates[0],
    end = route.coordinates.at(-1);
  if (!start || !end)
    return {
      ...route,
      straightM: 0,
      extraM: 0,
      maxOffLineM: 0,
      nearbyPois: route.nearbyPois ?? [],
    };
  const straightM = meters(start, end);
  return {
    ...route,
    straightM,
    extraM: Math.max(0, route.distanceM - straightM),
    maxOffLineM: maxOffLineM(route.coordinates, start, end),
    nearbyPois: route.nearbyPois ?? [],
  };
}
export function poisFromInstructions(route: Route): NearbyPoi[] {
  return route.instructions
    .filter((step) => /횡단|신호/.test(step.text))
    .map((step) => {
      const at = progressOnRoute(route.coordinates, step.coord);
      return {
        id: `instr:${step.coord.map((n) => n.toFixed(5)).join(",")}`,
        name: step.text.slice(0, 80),
        coord: step.coord,
        atM: at.traveledM,
        offPathM: at.offRouteM,
        source: "tmap-instruction" as const,
      };
    })
    .filter((p) => p.offPathM <= 60);
}
export function nextPoi(
  pois: NearbyPoi[] | undefined,
  traveledM: number,
): NearbyPoi | null {
  return (
    [...(pois ?? [])]
      .sort((a, b) => a.atM - b.atM)
      .find((p) => p.atM > traveledM + 8) ?? null
  );
}
export function validCoord(value: unknown): value is Coord {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(Number.isFinite) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}
export function validPace(n: number): boolean {
  return Number.isFinite(n) && n >= 120 && n <= 1800;
}
export function paceLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const n = Math.round(seconds);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
export function timeLabel(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
export function samplePath(points: Coord[], stepM = 30): Coord[] {
  if (points.length < 2) return points;
  const out: Coord[] = [points[0]];
  let rest = stepM;
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1];
    const b = points[i];
    let d = meters(a, b);
    while (d >= rest && d > 0) {
      const t = rest / d;
      a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(a);
      d = meters(a, b);
      rest = stepM;
    }
    rest -= d;
  }
  if (meters(out[out.length - 1], points[points.length - 1]) > 5)
    out.push(points[points.length - 1]);
  return out;
}
export function continuity(points: Coord[]): {
  sharpTurns: number;
  zigzags: number;
} {
  const sampled = samplePath(points),
    turns: { sign: number; i: number }[] = [];
  for (let i = 1; i < sampled.length - 1; i++) {
    const [a, b, c] = [sampled[i - 1], sampled[i], sampled[i + 1]];
    const scale = Math.cos((b[1] * Math.PI) / 180);
    const u = [(b[0] - a[0]) * scale, b[1] - a[1]],
      v = [(c[0] - b[0]) * scale, c[1] - b[1]];
    const cross = u[0] * v[1] - u[1] * v[0],
      dot = u[0] * v[0] + u[1] * v[1];
    const angle = (Math.atan2(cross, dot) * 180) / Math.PI;
    if (Math.abs(angle) >= 50) turns.push({ sign: Math.sign(angle), i });
  }
  return {
    sharpTurns: turns.length,
    zigzags: turns.filter(
      (t, i) =>
        i > 0 && t.sign !== turns[i - 1].sign && t.i - turns[i - 1].i <= 3,
    ).length,
  };
}
/** Direction-sensitive geometry key, not a route title or straight-line endpoint hash. */
export function routeKey(points: Coord[]): string {
  return samplePath(points)
    .map((p) => p.map((n) => n.toFixed(5)).join(","))
    .join(";");
}
export function isWalkableRoute(route: Route): boolean {
  return (
    route.coordinates.length >= 2 &&
    route.coordinates.every(validCoord) &&
    Number.isFinite(route.distanceM) &&
    route.distanceM > 0
  );
}

function sortWalkingBaseline(routes: Route[]): Route[] {
  return [...routes].sort(
    (a, b) =>
      a.zigzags - b.zigzags ||
      a.sharpTurns - b.sharpTurns ||
      (a.maxOffLineM ?? 0) - (b.maxOffLineM ?? 0) ||
      a.distanceM - b.distanceM,
  );
}

export function rankRoutes(
  routes: Route[],
  detourRatio = TRIAL_ROUTING_POLICY.detourRatio,
  maxExtraM = TRIAL_ROUTING_POLICY.detourMaxM,
): Route[] {
  if (!routes.length) return [];
  const unique = [
    ...new Map(routes.map((r) => [routeKey(r.coordinates), r])).values(),
  ];
  const shortest = Math.min(...unique.map((r) => r.distanceM));
  const cap = allowedExtraMeters(shortest, {
    detourRatio,
    detourMaxM: maxExtraM,
  });
  return sortWalkingBaseline(
    unique.filter((r) => r.distanceM <= shortest + cap),
  );
}

/**
 * Walkable → stairs/overpass/alley → dedupe → extra-distance cap →
 * walking baseline. Does not use provider payload order as the baseline.
 * Missing facility flags are 회피 확인 불가, not "confirmed no overpass".
 */
export function applyWalkingPolicy(
  routes: Route[],
  policy: RealRoutingPolicy = TRIAL_ROUTING_POLICY,
): { routes: Route[]; emptyReason: WalkingEmptyReason; avoidance: AvoidanceCheck } {
  const avoidance: AvoidanceCheck = {
    stairs: policy.avoidStairs ? "tmap-option-30" : "off",
    overpass: policy.avoidOverpass ? "unconfirmed" : "off",
    alley: policy.avoidAlley ? "unconfirmed" : "off",
  };
  const walkable = routes.filter(isWalkableRoute).map(withGeometry);
  if (!walkable.length)
    return { routes: [], emptyReason: "walkable", avoidance };

  let next = walkable;
  if (policy.avoidStairs) {
    next = next.filter((r) => r.option === "30");
    if (!next.length) return { routes: [], emptyReason: "stairs", avoidance };
  }
  if (policy.avoidOverpass) {
    const sawOverpass = walkable.some((r) => r.hasOverpass);
    next = next.filter((r) => !r.hasOverpass);
    if (sawOverpass) avoidance.overpass = "excluded";
    if (!next.length) return { routes: [], emptyReason: "overpass", avoidance };
  }
  if (policy.avoidAlley) {
    const sawAlley = walkable.some((r) => r.hasAlley);
    const wide = next.filter((r) => r.option === "4" || !r.hasAlley);
    if (wide.length) next = wide;
    if (sawAlley) avoidance.alley = "preferred-wide";
  }

  next = rankRoutes(next, policy.detourRatio, policy.detourMaxM);
  if (!next.length) return { routes: [], emptyReason: "detour", avoidance };
  next = preferFewerCrossings(next, policy);
  return { routes: next, emptyReason: "none", avoidance };
}
/** Unknown coverage is never converted to zero stops. Earlier waiting shifts every later ETA. */
export function forecast(
  routeM: number,
  pace: number,
  departureMs: number,
  crossings: Crossing[],
  completeCoverage: boolean,
  nowMs: number,
): Forecast {
  let previousM = 0,
    arrival = departureMs,
    wait = 0,
    stops = 0,
    max = 0,
    known = validPace(pace) && completeCoverage;
  const rows: Forecast["crossings"] = [];
  for (const c of [...crossings].sort((a, b) => a.atM - b.atM)) {
    if (
      !known ||
      !Number.isFinite(c.atM) ||
      c.atM < previousM ||
      c.atM > routeM ||
      !(c.widthM > 0)
    ) {
      known = false;
      rows.push({ id: c.id, arrivalMs: null, waitSec: null });
      continue;
    }
    arrival += ((c.atM - previousM) / 1000) * pace * 1000;
    previousM = c.atM;
    const p = c.plan;
    if (
      !p ||
      !Object.values(p).every(Number.isFinite) ||
      p.cycleSec <= 0 ||
      p.entryStartSec < 0 ||
      p.entryEndSec <= p.entryStartSec ||
      p.clearEndSec < p.entryEndSec ||
      p.clearEndSec > p.cycleSec ||
      p.uncertaintySec < 0 ||
      p.uncertaintySec > 3 ||
      nowMs - p.verifiedAtMs > ENGINE_PLAN_APPLIED_MAX_AGE_MS ||
      p.verifiedAtMs > nowMs + ENGINE_PLAN_CLOCK_SKEW_MS ||
      arrival < p.validFromMs ||
      arrival > p.validToMs
    ) {
      known = false;
      rows.push({ id: c.id, arrivalMs: arrival, waitSec: null });
      continue;
    }
    const phase =
      ((((arrival - p.epochMs) / 1000) % p.cycleSec) + p.cycleSec) % p.cycleSec;
    const crossSec = c.widthM / CROSSING_WALK_M_PER_SEC + CROSSING_BUFFER_SEC;
    const entryStart = p.entryStartSec + p.uncertaintySec;
    const latestEntry =
      Math.min(p.entryEndSec, p.clearEndSec - crossSec) - p.uncertaintySec;
    if (latestEntry <= entryStart) {
      known = false;
      rows.push({ id: c.id, arrivalMs: arrival, waitSec: null });
      continue;
    }
    const w =
      phase < entryStart
        ? entryStart - phase
        : phase < latestEntry
          ? 0
          : p.cycleSec - phase + entryStart;
    if (arrival + (w + crossSec) * 1000 > p.validToMs) {
      known = false;
      rows.push({ id: c.id, arrivalMs: arrival, waitSec: null });
      continue;
    }
    rows.push({ id: c.id, arrivalMs: arrival, waitSec: w });
    arrival += w * 1000;
    wait += w;
    if (w > 0) stops++;
    max = Math.max(max, w);
  }
  return {
    waitSec: known ? wait : null,
    stops: known ? stops : null,
    maxWaitSec: known ? max : null,
    totalSec: known ? (routeM / 1000) * pace + wait : null,
    crossings: rows,
  };
}
export function preferSignalRoute(
  candidates: { route: Route; forecast: Forecast }[],
  policy: RealRoutingPolicy = TRIAL_ROUTING_POLICY,
): (typeof candidates)[number] | null {
  const base = candidates[0];
  if (
    !base ||
    base.forecast.maxWaitSec === null ||
    base.forecast.maxWaitSec < policy.waitThresholdSec
  )
    return base ?? null;
  const extra = allowedExtraMeters(base.route.distanceM, policy);
  const valid = candidates.filter(
    (c) =>
      c.forecast.waitSec !== null &&
      c.forecast.stops !== null &&
      c.forecast.maxWaitSec !== null &&
      c.route.zigzags <= base.route.zigzags &&
      c.route.sharpTurns <= base.route.sharpTurns + policy.extraSharpTurns &&
      c.route.distanceM <= base.route.distanceM + extra,
  );
  return (
    valid.sort(
      (a, b) =>
        a.forecast.stops! - b.forecast.stops! ||
        a.forecast.waitSec! - b.forecast.waitSec! ||
        a.route.distanceM - b.route.distanceM,
    )[0] ?? base
  );
}
export function crossingCount(route: Route): number {
  return route.nearbyPois?.length ?? 0;
}
/** Prefer fewer TMAP/Kakao 횡단 안내 points. Does not invent wait seconds. */
export function preferFewerCrossings(
  routes: Route[],
  policy: RealRoutingPolicy = TRIAL_ROUTING_POLICY,
): Route[] {
  if (routes.length < 2) return routes;
  const base = routes[0];
  const extra = allowedExtraMeters(base.distanceM, policy);
  const pick =
    [...routes]
      .filter(
        (r) =>
          r.zigzags <= base.zigzags &&
          r.sharpTurns <= base.sharpTurns + policy.extraSharpTurns &&
          r.distanceM <= base.distanceM + extra,
      )
      .sort(
        (a, b) =>
          crossingCount(a) - crossingCount(b) || a.distanceM - b.distanceM,
      )[0] ?? base;
  if (pick.id === base.id) return routes;
  return [pick, ...routes.filter((r) => r.id !== pick.id)];
}
export function scanFacilities(
  features: { properties?: { facilityType?: unknown; description?: unknown; facilityName?: unknown } }[],
): { hasStairs: boolean; hasOverpass: boolean; hasAlley: boolean; facilityHints: boolean } {
  const flags = {
    hasStairs: false,
    hasOverpass: false,
    hasAlley: false,
    facilityHints: false,
  };
  for (const f of features) {
    const type = String(f.properties?.facilityType ?? "");
    const text = `${f.properties?.description ?? ""} ${f.properties?.facilityName ?? ""}`;
    if (type || text.trim()) flags.facilityHints = true;
    if (type === "15" || /계단/.test(text)) flags.hasStairs = true;
    if (
      type === "1" ||
      type === "3" ||
      type === "12" ||
      /육교|고가|지하보도|지하차도/.test(text)
    )
      flags.hasOverpass = true;
    if (/골목|이면도로|좁은 길/.test(text)) flags.hasAlley = true;
  }
  return flags;
}
export function bearingDeg(a: Coord, b: Coord): number {
  const φ1 = (a[1] * Math.PI) / 180,
    φ2 = (b[1] * Math.PI) / 180,
    Δ = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(Δ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
export function cueEtaSec(remainM: number, pace: number): number | null {
  if (!validPace(pace) || !(remainM > 0)) return null;
  return (remainM / 1000) * pace;
}
export type Fix = {
  coord: Coord;
  at: number;
  accuracy: number;
  heading?: number;
  segmentStart?: boolean;
};
export type Track = {
  fixes: Fix[];
  distanceM: number;
  gapSec: number;
  stoppedSec: number;
  anchor?: Fix;
};
export function appendFix(track: Track, fix: Fix): Track {
  if (
    !validCoord(fix.coord) ||
    !Number.isFinite(fix.at) ||
    !Number.isFinite(fix.accuracy) ||
    fix.accuracy < 0 ||
    fix.accuracy > 30
  )
    return track;
  const prev = track.fixes.at(-1);
  if (!prev) return { ...track, fixes: [fix], anchor: fix };
  const dt = (fix.at - prev.at) / 1000;
  if (dt <= 0) return track;
  const d = meters(prev.coord, fix.coord);
  // Long gaps create a new segment. Never connect a background GPS gap as distance.
  if (dt > 15 || fix.segmentStart)
    return {
      ...track,
      fixes: [...track.fixes, { ...fix, segmentStart: true }],
      gapSec: track.gapSec + (fix.segmentStart ? 0 : dt),
      anchor: fix,
    };
  if (d / dt > 10) return track;
  const anchor = track.anchor ?? prev,
    accumulated = meters(anchor.coord, fix.coord);
  const moved =
    accumulated >=
    Math.max(3, Math.min(8, (anchor.accuracy + fix.accuracy) / 3));
  const stationary = d / dt < 0.5;
  return {
    ...track,
    fixes: [...track.fixes, fix],
    distanceM: track.distanceM + (moved ? accumulated : 0),
    anchor: moved ? fix : anchor,
    stoppedSec: track.stoppedSec + (stationary ? dt : 0),
  };
}
/** Conservative completion: sample the actual path, require ordered progress and no major jumps. */
export function routeCompleted(route: Route, track: Track): boolean {
  if (
    track.gapSec > 0 ||
    track.distanceM < route.distanceM * 0.95 ||
    track.distanceM > route.distanceM * 1.1 ||
    track.fixes.length < 2
  )
    return false;
  if (
    meters(track.fixes[0].coord, route.coordinates[0]) > 60 ||
    meters(track.fixes.at(-1)!.coord, route.coordinates.at(-1)!) > 60
  )
    return false;
  const path = samplePath(route.coordinates, 20);
  let progress = 0;
  for (const fix of track.fixes) {
    let closest = progress,
      distance = Infinity;
    for (
      let i = Math.max(0, progress - 3);
      i <= Math.min(path.length - 1, progress + 8);
      i++
    ) {
      const d = meters(fix.coord, path[i]);
      if (d < distance) {
        closest = i;
        distance = d;
      }
    }
    if (distance > Math.min(45, fix.accuracy + 20)) return false;
    progress = Math.max(progress, closest);
  }
  return progress >= path.length - 3;
}
export function trackSegments(fixes: Fix[]): Coord[][] {
  const segments: Coord[][] = [];
  for (const fix of fixes) {
    if (!segments.length || fix.segmentStart) segments.push([]);
    segments.at(-1)!.push(fix.coord);
  }
  return segments.filter((s) => s.length >= 2);
}
