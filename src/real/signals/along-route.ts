import {
  bearingDeg,
  meters,
  progressOnRoute,
  type Coord,
  type Route,
} from "../core.ts";
import type { CrossingRecord } from "./schema.ts";

export const ALONG_ROUTE_MATCH_M = 40;
export const ALONG_ROUTE_BEARING_DEG = 50;

function midpoint(a: Coord, b: Coord): Coord {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function pathBearingAt(path: Coord[], atM: number): number | null {
  if (path.length < 2) return null;
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = meters(a, b);
    if (acc + len >= atM || i === path.length - 2) return bearingDeg(a, b);
    acc += len;
  }
  return bearingDeg(path[0], path[1]);
}

export type AlongHit = {
  crossing: CrossingRecord;
  atM: number;
  offPathM: number;
  bearingOk: boolean;
};

/** Place a crossing on the runner path. atM follows the polyline, not a straight cut. */
export function locateCrossingOnRoute(
  route: Route,
  crossing: CrossingRecord,
  matchM = ALONG_ROUTE_MATCH_M,
): AlongHit | null {
  const mid = midpoint(crossing.entryCoord, crossing.exitCoord);
  const along = progressOnRoute(route.coordinates, mid);
  if (along.offRouteM > matchM) return null;
  const travel = pathBearingAt(route.coordinates, along.traveledM);
  const bearingOk =
    travel === null
      ? false
      : angleDiffDeg(travel, crossing.travel.bearingDeg) <= ALONG_ROUTE_BEARING_DEG;
  return {
    crossing,
    atM: along.traveledM,
    offPathM: along.offRouteM,
    bearingOk,
  };
}

export function crossingsAlongRoute(
  route: Route,
  crossings: CrossingRecord[],
  matchM = ALONG_ROUTE_MATCH_M,
): AlongHit[] {
  return crossings
    .map((c) => locateCrossingOnRoute(route, c, matchM))
    .filter((h): h is AlongHit => !!h && h.bearingOk)
    .sort((a, b) => a.atM - b.atM || a.crossing.stageIndex - b.crossing.stageIndex);
}
