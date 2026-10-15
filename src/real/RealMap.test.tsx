import { describe, expect, it } from "vitest";

import {
  accuracyCircleData,
  endpointDisplayPoints,
  lineFeatureData,
  mapInitialCenter,
  mapBoundsPoints,
  routeGeometryData,
  splitOverlayPoints,
  type MapPoint,
} from "./RealMap.helpers.ts";

describe("real map overlays", () => {
  it("keeps origin and destination out of the regular POI collision layer", () => {
    const points: MapPoint[] = [
      { coord: [127, 37], name: "출발 · 명지대학교 인문캠퍼스", kind: "origin" },
      { coord: [127.1, 37.1], name: "성남시청", kind: "destination" },
      { coord: [127.01, 37.01], name: "카페", kind: "pin" },
    ];

    expect(splitOverlayPoints(points)).toMatchObject({
      endpoints: [points[0], points[1]],
      regular: [points[2]],
    });
  });

  it("formats endpoint labels distinctly and offsets overlapping endpoints", () => {
    const endpoints = endpointDisplayPoints([
      { coord: [127, 37], name: "출발 · 같은 곳", kind: "origin" },
      { coord: [127, 37], name: "도착 · 같은 곳", kind: "destination" },
    ]);

    expect(endpoints.map((p) => p.name)).toEqual([
      "출발 · 같은 곳",
      "도착 · 같은 곳",
    ]);
    expect(endpoints[1].coord).not.toEqual(endpoints[0].coord);
  });

  it("fits route geometry together with selected origin and destination points", () => {
    const bounds = mapBoundsPoints({
      coordinates: [
        [127.02, 37.02],
        [127.03, 37.03],
      ],
      pois: [
        { coord: [126.9, 37.5], name: "출발", kind: "origin" },
        { coord: [127.2, 37.8], name: "도착", kind: "destination" },
      ],
      position: [128, 38],
    });

    expect(bounds).toEqual([
      [127.02, 37.02],
      [127.03, 37.03],
      [126.9, 37.5],
      [127.2, 37.8],
    ]);
  });

  it("centers on the current location before falling back to route or default", () => {
    expect(
      mapInitialCenter({
        coordinates: [
          [127.2, 37.8],
          [127.3, 37.9],
        ],
        position: [126.92277, 37.57961],
      }),
    ).toEqual([126.92277, 37.57961]);
    expect(
      mapInitialCenter({
        coordinates: [
          [127.2, 37.8],
          [127.3, 37.9],
        ],
      }),
    ).toEqual([127.2, 37.8]);
  });

  it("serializes route lines and recorded route segments for the map source", () => {
    expect(
      lineFeatureData([
        [127, 37],
        [127.01, 37.01],
      ]),
    ).toMatchObject({
      geometry: { type: "LineString" },
    });
    expect(
      routeGeometryData({
        segments: [
          [
            [127, 37],
            [127.01, 37.01],
          ],
        ],
      }),
    ).toMatchObject({
      geometry: { type: "MultiLineString" },
    });
  });

  it("builds an accuracy circle around the active GPS position", () => {
    const circle = accuracyCircleData([127, 37], 18);
    expect(circle.type).toBe("Feature");
    if (circle.type !== "Feature") throw new Error("Expected accuracy feature");
    expect(circle.geometry.type).toBe("Polygon");
    expect(circle.geometry.coordinates[0]).toHaveLength(49);
  });
});
