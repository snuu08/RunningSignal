import type { GeoPoint, LocalMetersPoint, Wgs84Point } from "./models.ts";

export function localPoint(x: number, y: number): LocalMetersPoint {
  return { system: "local-meters", x, y };
}

export function polylineLength(points: LocalMetersPoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += localDistance(points[i - 1], points[i]);
  }
  return sum;
}

export function localDistance(a: LocalMetersPoint, b: LocalMetersPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  if (a.system !== b.system) {
    throw new Error("Cannot combine local-meters and WGS84 without an adapter");
  }
  if (a.system === "local-meters" && b.system === "local-meters") {
    return localDistance(a, b);
  }
  throw new Error("WGS84 distance must be computed in a coordinate adapter");
}

export function headingDeg(from: LocalMetersPoint, to: LocalMetersPoint): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

export function angleDeltaDeg(a: number, b: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export function reverseGeometry(points: LocalMetersPoint[]): LocalMetersPoint[] {
  return [...points].reverse();
}

export function pointAlongPolyline(
  points: LocalMetersPoint[],
  distanceM: number,
): LocalMetersPoint {
  if (points.length === 0) return localPoint(0, 0);
  if (distanceM <= 0) return points[0];
  let remain = distanceM;
  for (let i = 1; i < points.length; i += 1) {
    const seg = localDistance(points[i - 1], points[i]);
    if (remain <= seg) {
      const t = seg === 0 ? 0 : remain / seg;
      return localPoint(
        points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      );
    }
    remain -= seg;
  }
  return points[points.length - 1];
}

export function boundsOf(points: LocalMetersPoint[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Future real-map adapter hook. Not used by the demo network. */
export function haversineMeters(a: Wgs84Point, b: Wgs84Point): number {
  const r = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function curvePoints(
  from: LocalMetersPoint,
  mid: LocalMetersPoint,
  to: LocalMetersPoint,
  samples = 8,
): LocalMetersPoint[] {
  const out: LocalMetersPoint[] = [from];
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const u = 1 - t;
    out.push(
      localPoint(
        u * u * from.x + 2 * u * t * mid.x + t * t * to.x,
        u * u * from.y + 2 * u * t * mid.y + t * t * to.y,
      ),
    );
  }
  out.push(to);
  return out;
}
