import { describe, expect, it } from "vitest";
import {
  bestAccuracyFix,
  classifyLocationAccuracy,
  correctedBrowserLocation,
  displayLocationFromFix,
  displayLocationForRoute,
  distinctLocationFixes,
  filterLocationOutliers,
  geolocationErrorReason,
  isFreshLocationFix,
  locationAcquisitionFromFixes,
  locationSamplesFailureReason,
  validateDisplayFix,
  validateFix,
} from "./location-quality.ts";
import { appendFix, type Coord, type Track } from "./core.ts";

describe("location quality", () => {
  it("classifies GPS accuracy into good, usable, poor, and unreliable bands", () => {
    expect(classifyLocationAccuracy(30)).toBe("good");
    expect(classifyLocationAccuracy(80)).toBe("usable");
    expect(classifyLocationAccuracy(200)).toBe("poor");
    expect(classifyLocationAccuracy(201)).toBe("unreliable");
    expect(classifyLocationAccuracy(Number.NaN)).toBe("unreliable");
  });

  it("picks the most accurate valid fix and prefers the latest tie", () => {
    expect(
      bestAccuracyFix([
        { accuracy: 50, at: 1 },
        { accuracy: 12, at: 2 },
        { accuracy: 12, at: 3 },
        { accuracy: 300, at: 4 },
      ]),
    ).toEqual({ accuracy: 12, at: 3 });
  });

  it("rejects stale fixes", () => {
    expect(isFreshLocationFix({ at: 1000 }, 35_001)).toBe(false);
    expect(isFreshLocationFix({ at: 1000 }, 31_000)).toBe(true);
  });

  it("accepts one precise current fix", () => {
    const now = 10_000;
    const acquired = locationAcquisitionFromFixes(
      [{ coord: [127, 37], accuracy: 8, at: now }],
      now,
      "granted",
    );

    expect(acquired).toMatchObject({
      quality: "good",
      source: "browser-geolocation",
      permission: "granted",
    });
  });

  it("improves confidence as accuracy gets better", () => {
    const now = 10_000;
    const acquired = locationAcquisitionFromFixes(
      [
        { coord: [127, 37], accuracy: 120, at: now - 3_000 },
        { coord: [127.00001, 37.00001], accuracy: 55, at: now - 2_000 },
        { coord: [127.00001, 37.00001], accuracy: 16, at: now - 1_000 },
        { coord: [127.00002, 37.00002], accuracy: 14, at: now },
      ],
      now,
    );

    expect(acquired?.quality).toBe("good");
    expect(acquired?.confidence).toBeGreaterThan(0.7);
  });

  it("removes impossible jumps while preserving a stable nearby cluster", () => {
    const now = 10_000;
    const filtered = filterLocationOutliers(
      [
        { coord: [127, 37], accuracy: 18, at: now - 4_000 },
        { coord: [127.00001, 37.00001], accuracy: 16, at: now - 3_000 },
        { coord: [128, 38], accuracy: 12, at: now - 2_500 },
        { coord: [127.00002, 37.00002], accuracy: 14, at: now - 2_000 },
      ],
      now,
    );

    expect(filtered).toHaveLength(3);
    expect(filtered.some((fix) => fix.coord[0] === 128)).toBe(false);
  });

  it("deduplicates repeated timestamps and keeps the better accuracy", () => {
    const fixes = distinctLocationFixes([
      { coord: [127, 37], accuracy: 40, at: 1000 },
      { coord: [127.00001, 37.00001], accuracy: 15, at: 1000 },
    ]);

    expect(fixes).toEqual([
      { coord: [127.00001, 37.00001], accuracy: 15, at: 1000 },
    ]);
  });

  it("classifies stale and too-inaccurate fixes without converting them to usable", () => {
    expect(validateFix({ coord: [127, 37], accuracy: 20, at: 1 }, 40_000)).toMatchObject({
      ok: false,
      reason: "stale",
    });
    expect(validateFix({ coord: [127, 37], accuracy: 201, at: 40_000 }, 40_000)).toMatchObject({
      ok: false,
      reason: "inaccurate",
    });
    expect(
      locationSamplesFailureReason(
        [{ coord: [127, 37], accuracy: 201, at: 40_000 }],
        40_000,
      ),
    ).toBe("inaccurate");
  });

  it("accepts display locations with low accuracy while running validation rejects them", () => {
    const fix = { coord: [127, 37] as Coord, accuracy: 350, at: 40_000 };

    expect(validateDisplayFix(fix, 40_000)).toMatchObject({ ok: true });
    expect(validateFix(fix, 40_000)).toMatchObject({
      ok: false,
      reason: "inaccurate",
    });
    expect(displayLocationFromFix(fix, "prompt")).toMatchObject({
      quality: "unreliable",
      permission: "prompt",
      requiresConfirmation: true,
      displayOnly: true,
    });
  });

  it("marks display locations with 150m accuracy as low quality but usable for display", () => {
    const fix = { coord: [127, 37] as Coord, accuracy: 150, at: 40_000 };

    expect(validateDisplayFix(fix, 40_000)).toMatchObject({ ok: true });
    expect(displayLocationFromFix(fix, "granted")).toMatchObject({
      quality: "poor",
      requiresConfirmation: true,
    });
  });

  it("marks display locations with 20m accuracy as good", () => {
    const fix = { coord: [127, 37] as Coord, accuracy: 20, at: 40_000 };

    expect(validateDisplayFix(fix, 40_000)).toMatchObject({ ok: true });
    expect(displayLocationFromFix(fix, "granted")).toMatchObject({
      quality: "good",
      requiresConfirmation: false,
    });
  });

  it("rejects movement above the running speed plausibility threshold", () => {
    const now = 20_000;
    const filtered = filterLocationOutliers(
      [
        { coord: [127, 37], accuracy: 8, at: now - 10_000 },
        { coord: [127.002, 37], accuracy: 8, at: now },
      ],
      now,
    );

    expect(filtered).toHaveLength(1);
  });

  it("rejects a one-second GPS jump over 60 meters", () => {
    const now = 20_000;
    const filtered = filterLocationOutliers(
      [
        { coord: [127, 37], accuracy: 8, at: now - 1_000 },
        { coord: [127, 37.0006], accuracy: 8, at: now },
      ],
      now,
    );

    expect(filtered).toHaveLength(1);
  });

  it("does not let 50m accuracy permit a near-100m jump", () => {
    const now = 20_000;
    const filtered = filterLocationOutliers(
      [
        { coord: [127, 37], accuracy: 50, at: now - 1_000 },
        { coord: [127, 37.00085], accuracy: 50, at: now },
      ],
      now,
    );

    expect(filtered).toHaveLength(1);
  });

  it("accepts normal running movement", () => {
    const now = 20_000;
    const filtered = filterLocationOutliers(
      [
        { coord: [127, 37], accuracy: 8, at: now - 1_000 },
        { coord: [127, 37.00004], accuracy: 8, at: now },
      ],
      now,
    );

    expect(filtered).toHaveLength(2);
  });

  it("keeps stationary jitter from inflating recorded distance", () => {
    const empty: Track = { fixes: [], distanceM: 0, gapSec: 0, stoppedSec: 0 };
    let track = appendFix(empty, { coord: [127, 37], accuracy: 8, at: 10_000 });
    for (let i = 1; i <= 8; i++)
      track = appendFix(track, {
        coord: [127 + i * 0.000002, 37],
        accuracy: 8,
        at: 10_000 + i * 1000,
      });

    expect(track.distanceM).toBeLessThan(3);
    expect(track.stoppedSec).toBeGreaterThan(0);
  });

  it("returns a browser-filtered corrected location with confidence metadata", () => {
    const now = 10_000;
    const corrected = correctedBrowserLocation(
      [
        { coord: [126.9225, 37.57961], accuracy: 55, at: now - 3_000 },
        { coord: [126.92252, 37.57962], accuracy: 52, at: now - 2_000 },
        { coord: [126.92251, 37.5796], accuracy: 50, at: now - 1_000 },
      ],
      now,
    );

    expect(corrected).toMatchObject({
      source: "browser-filtered",
      requiresConfirmation: true,
    });
    expect(corrected?.confidence).toBeGreaterThan(0.4);
    expect(corrected?.reportedAccuracyMeters).toBeGreaterThan(30);
  });

  it("keeps acquisition metadata separate from the final fix", () => {
    const now = 20_000;
    const acquired = locationAcquisitionFromFixes(
      [
        { coord: [127, 37], accuracy: 60, at: now - 2_000 },
        { coord: [127.00001, 37.00001], accuracy: 58, at: now - 1_000 },
        { coord: [127.00002, 37.00002], accuracy: 62, at: now },
      ],
      now,
    );

    expect(acquired).toMatchObject({
      quality: "usable",
      requiresConfirmation: true,
      source: "browser-filtered",
    });
    expect(acquired?.rawSamples).toHaveLength(3);
    expect(acquired?.fix.accuracy).toBeGreaterThan(30);
  });

  it("projects display location only when GPS is near the route", () => {
    const route: { coordinates: Coord[] } = {
      coordinates: [
        [127, 37],
        [127.01, 37],
      ],
    };
    const near = displayLocationForRoute(
      { coord: [127.005, 37.00005], accuracy: 12, at: 1 },
      route,
    );
    const far = displayLocationForRoute(
      { coord: [127.005, 37.01], accuracy: 12, at: 1 },
      route,
    );

    expect(near.routeProjection?.usedForDisplay).toBe(true);
    expect(near.displayFix.coord[1]).toBeCloseTo(37, 6);
    expect(near.recordingFix.coord).toEqual([127.005, 37.00005]);
    expect(far.routeProjection?.usedForDisplay).toBe(false);
    expect(far.displayFix.coord).toEqual([127.005, 37.01]);
  });

  it("keeps poor GPS raw even when it is near the route", () => {
    const projected = displayLocationForRoute(
      { coord: [127.005, 37.00005], accuracy: 160, at: 1 },
      {
        coordinates: [
          [127, 37] as Coord,
          [127.01, 37] as Coord,
        ],
      },
    );

    expect(projected.routeProjection?.usedForDisplay).toBe(false);
    expect(projected.displayFix.coord).toEqual([127.005, 37.00005]);
  });

  it("caps route projection distance for usable GPS", () => {
    const projected = displayLocationForRoute(
      { coord: [127.005, 37.00065], accuracy: 55, at: 1 },
      {
        coordinates: [
          [127, 37] as Coord,
          [127.01, 37] as Coord,
        ],
      },
    );

    expect(projected.routeProjection?.thresholdM).toBeLessThanOrEqual(60);
    expect(projected.routeProjection?.usedForDisplay).toBe(false);
    expect(projected.displayFix.coord).toEqual([127.005, 37.00065]);
  });

  it("keeps route projection near previous progress on looped routes", () => {
    const route = {
      coordinates: [
        [127, 37],
        [127, 37.02],
        [127.002, 37.02],
        [127.002, 37],
        [127, 37],
      ] as Coord[],
    };
    const projected = displayLocationForRoute(
      { coord: [127.00195, 37.001], accuracy: 8, at: 1 },
      route,
      120,
    );

    expect(projected.routeProjection?.traveledM).toBeLessThan(500);
    expect(projected.routeProjection?.usedForDisplay).toBe(false);
  });

  it("maps browser geolocation errors to separate failure reasons", () => {
    expect(geolocationErrorReason({ code: 1 })).toBe("permission-denied");
    expect(geolocationErrorReason({ code: 2 })).toBe("position-unavailable");
    expect(geolocationErrorReason({ code: 3 })).toBe("timeout");
  });
});
