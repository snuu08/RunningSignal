import { describe, expect, it } from "vitest";
import { appendFix, meters, type Coord, type Fix, type Track } from "./core.ts";
import {
  displayLocationForRoute,
  filterLocationOutliers,
  normalizeGeolocationPosition,
  validateFix,
} from "./location-quality.ts";

// Synthetic coordinates in Seoul. These are regression checks, not field GPS data.
const origin: Coord = [127.03, 37.51];
const epoch = 1_800_000_000_000;
const eastMetersPerDegree = meters(origin, [origin[0] + 1, origin[1]]);
function position(eastM: number): Coord {
  return [origin[0] + eastM / eastMetersPerDegree, origin[1]];
}
function simulate(eastM: number[], accuracy: number | ((i: number) => number)) {
  let track: Track = { fixes: [], distanceM: 0, gapSec: 0, stoppedSec: 0 };
  let samples: Fix[] = [];
  for (const [i, east] of eastM.entries()) {
    const fix: Fix = {
      coord: position(east), at: epoch + i * 5000,
      accuracy: typeof accuracy === "number" ? accuracy : accuracy(i),
    };
    samples = filterLocationOutliers([...samples, fix], fix.at).slice(-8);
    const accepted = samples.at(-1);
    if (accepted?.at === fix.at) track = appendFix(track, accepted);
  }
  return track;
}

describe("Seoul synthetic GPS regression", () => {
  it("keeps browser longitude/latitude in the map's WGS84 order", () => {
    const fix = normalizeGeolocationPosition({
      coords: { longitude: origin[0], latitude: origin[1], accuracy: 5 },
      timestamp: epoch,
    } as GeolocationPosition);
    expect(fix.coord).toEqual(origin);
    expect(validateFix(fix, epoch).ok).toBe(true);
  });

  it.each([5, 20, 60])("records 1km of steady movement with %im reported accuracy", (accuracy) => {
    const track = simulate(Array.from({ length: 81 }, (_, i) => i * 12.5), accuracy);
    expect(track.distanceM).toBeGreaterThanOrEqual(1000 - accuracy - 1);
    expect(track.distanceM).toBeLessThanOrEqual(1001);
    expect(track.gapSec).toBe(0);
  });

  it.each([
    { accuracy: 5, jitterM: 2 },
    { accuracy: 20, jitterM: 6 },
    { accuracy: 60, jitterM: 20 },
  ])("does not turn stationary ±$jitterM m jitter into distance at $accuracy m accuracy", ({ accuracy, jitterM }) => {
    const track = simulate(Array.from({ length: 25 }, (_, i) => i % 2 ? jitterM : -jitterM), accuracy);
    expect(track.distanceM).toBe(0);
    expect(track.fixes).toHaveLength(25);
  });

  it("starts recording useful movement after startup accuracy improves", () => {
    const track = simulate(Array.from({ length: 81 }, (_, i) => i * 12.5), (i) => i < 10 ? 60 : 5);
    expect(track.distanceM).toBeGreaterThan(950);
    expect(track.distanceM).toBeLessThan(1001);
  });

  it("keeps a distant GPS jump out of the Seoul running distance", () => {
    const first = { coord: origin, at: epoch, accuracy: 5 };
    const jump = { coord: position(1000), at: epoch + 1000, accuracy: 5 };
    const filtered = filterLocationOutliers([first, jump], jump.at);
    expect(filtered).toEqual([first]);
    const track = appendFix(appendFix({ fixes: [], distanceM: 0, gapSec: 0, stoppedSec: 0 }, first), jump);
    expect(track.distanceM).toBe(0);
  });

  it("does not bridge either a 60-second GPS outage or a manual pause", () => {
    const initial = appendFix({ fixes: [], distanceM: 0, gapSec: 0, stoppedSec: 0 }, { coord: origin, at: epoch, accuracy: 5 });
    const resumed = { coord: position(150), at: epoch + 60_000, accuracy: 5 };
    const gap = appendFix(initial, resumed);
    const pause = appendFix(initial, { ...resumed, segmentStart: true });
    expect(gap.distanceM).toBe(0);
    expect(gap.gapSec).toBe(60);
    expect(pause.distanceM).toBe(0);
    expect(pause.gapSec).toBe(0);
  });

  it("projects the Seoul map marker without changing recorded GPS coordinates", () => {
    const route = { coordinates: [origin, position(1000)] };
    const raw: Fix = { coord: [position(500)[0], origin[1] + 0.0001], at: epoch, accuracy: 12 };
    const projected = displayLocationForRoute(raw, route);
    expect(projected.routeProjection?.usedForDisplay).toBe(true);
    expect(projected.displayFix.coord[1]).toBeCloseTo(origin[1], 8);
    expect(projected.recordingFix.coord).toEqual(raw.coord);
  });
});
