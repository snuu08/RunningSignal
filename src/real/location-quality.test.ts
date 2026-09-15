import { describe, expect, it } from "vitest";
import {
  bestAccuracyFix,
  classifyLocationAccuracy,
  correctedBrowserLocation,
  filterLocationOutliers,
  hasNativeMultipathInputs,
  isFreshLocationFix,
} from "./location-quality.ts";

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

  it("enables multipath correction only when every native input is present", () => {
    expect(
      hasNativeMultipathInputs({
        rawGnssAvailable: true,
        ephemerisAvailable: true,
        dgnssAvailable: false,
        skyModelAvailable: true,
        multipathMapAvailable: true,
        observationMatrixAvailable: true,
      }),
    ).toBe(true);
    expect(
      hasNativeMultipathInputs({
        rawGnssAvailable: true,
        ephemerisAvailable: false,
        dgnssAvailable: false,
        skyModelAvailable: true,
        multipathMapAvailable: true,
        observationMatrixAvailable: true,
      }),
    ).toBe(false);
  });
});
