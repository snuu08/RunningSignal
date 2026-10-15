import { describe, expect, it } from "vitest";
import {
  asLandmark,
  landmarkKindsForZoom,
  parseLandmarkKinds,
} from "./landmarks.ts";

describe("landmark helpers", () => {
  it("keeps only documented Kakao category kinds", () => {
    expect(parseLandmarkKinds("station,cafe,restaurant,convenience,school,other")).toEqual([
      "station",
      "cafe",
      "restaurant",
      "convenience",
      "school",
    ]);
    expect(parseLandmarkKinds("")).toEqual([
      "station",
      "cafe",
      "restaurant",
      "convenience",
      "school",
    ]);
    expect(parseLandmarkKinds("cafe")).toEqual(["cafe"]);
  });

  it("shows stations before cafes as the map zooms in", () => {
    expect(landmarkKindsForZoom(11)).toEqual([]);
    expect(landmarkKindsForZoom(12.5)).toEqual(["station"]);
    expect(landmarkKindsForZoom(13.5)).toEqual(["station", "cafe", "restaurant"]);
    expect(landmarkKindsForZoom(15)).toEqual([
      "station",
      "cafe",
      "restaurant",
      "convenience",
      "school",
    ]);
  });

  it("drops malformed landmark rows", () => {
    expect(
      asLandmark({
        id: "1",
        name: "시청역",
        coord: [126.978, 37.566],
        kind: "station",
      })?.name,
    ).toBe("시청역");
    expect(asLandmark({ id: "1", name: "x", coord: [200, 0], kind: "cafe" })).toBeNull();
  });
});
