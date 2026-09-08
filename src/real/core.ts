/** Real-world coordinates are always [longitude, latitude], WGS84. */
export type Coord = [number, number];
export type Place = {
  id: string;
  name: string;
  coord: Coord;
  address?: string;
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
};
export type FixedPlan = {
  cycleSec: number;
  epochMs: number;
  entryStartSec: number;
  entryEndSec: number;
  clearEndSec: number;
  validFromMs: number;
  validToMs: number;
  verifiedAtMs: number;
  uncertaintySec: number;
};
/** Crossing associations must be verified against BOTH walking direction and geometry. */
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
export function rankRoutes(
  routes: Route[],
  detourRatio = 0.1,
  maxExtraM = 300,
): Route[] {
  if (!routes.length) return [];
  const shortest = Math.min(...routes.map((r) => r.distanceM));
  const eligible = routes.filter(
    (r) =>
      r.distanceM <= shortest + Math.min(shortest * detourRatio, maxExtraM),
  );
  const unique = [
    ...new Map(eligible.map((r) => [routeKey(r.coordinates), r])).values(),
  ];
  return unique.sort(
    (a, b) =>
      a.zigzags - b.zigzags ||
      a.sharpTurns - b.sharpTurns ||
      a.distanceM - b.distanceM,
  );
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
      nowMs - p.verifiedAtMs > 60000 ||
      p.verifiedAtMs > nowMs + 1000 ||
      arrival < p.validFromMs ||
      arrival > p.validToMs
    ) {
      known = false;
      rows.push({ id: c.id, arrivalMs: arrival, waitSec: null });
      continue;
    }
    const phase =
      ((((arrival - p.epochMs) / 1000) % p.cycleSec) + p.cycleSec) % p.cycleSec;
    const crossSec = (c.widthM / 1000) * pace + 3;
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
): (typeof candidates)[number] | null {
  const base = candidates[0];
  if (
    !base ||
    base.forecast.maxWaitSec === null ||
    base.forecast.maxWaitSec < 15
  )
    return base ?? null;
  const valid = candidates.filter(
    (c) =>
      c.forecast.waitSec !== null &&
      c.forecast.stops !== null &&
      c.route.zigzags <= base.route.zigzags &&
      c.route.sharpTurns <= base.route.sharpTurns + 2 &&
      c.route.distanceM <=
        base.route.distanceM + Math.min(base.route.distanceM * 0.1, 300),
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
export type Fix = {
  coord: Coord;
  at: number;
  accuracy: number;
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
