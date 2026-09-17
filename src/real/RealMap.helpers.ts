import type { Coord } from "./core.ts";

export const DEFAULT_MAP_CENTER: Coord = [127.03, 37.51];

export const emptyFeatureCollection = {
  type: "FeatureCollection" as const,
  features: [],
};

export type MapPoint = {
  coord: Coord;
  name: string;
  kind?: "pin" | "origin" | "destination";
};

const endpointKinds = new Set(["origin", "destination"]);

function isEndpoint(p: MapPoint) {
  return endpointKinds.has(p.kind ?? "");
}

function metersBetween(a: Coord, b: Coord) {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(lat);
  const dy = (b[1] - a[1]) * 111_320;
  return Math.hypot(dx, dy);
}

function shiftedCoord(coord: Coord, eastM: number, northM: number): Coord {
  const lng =
    coord[0] +
    eastM / (111_320 * Math.max(0.2, Math.cos((coord[1] * Math.PI) / 180)));
  const lat = coord[1] + northM / 111_320;
  return [lng, lat];
}

export function splitOverlayPoints(pois: MapPoint[]) {
  return {
    endpoints: pois.filter(isEndpoint),
    regular: pois.filter((p) => !isEndpoint(p)),
  };
}

export function endpointDisplayPoints(pois: MapPoint[]) {
  const endpoints = pois.filter(isEndpoint);
  const origin = endpoints.find((p) => p.kind === "origin");
  const destination = endpoints.find((p) => p.kind === "destination");
  const overlap =
    origin && destination && metersBetween(origin.coord, destination.coord) < 16;
  return endpoints.map((p) => {
    const label = `${p.kind === "origin" ? "출발" : "도착"} · ${p.name.replace(/^(출발|도착)\s*[·ㆍ・]\s*/u, "")}`;
    const coord =
      overlap && p.kind === "destination"
        ? shiftedCoord(p.coord, 10, 10)
        : p.coord;
    return { ...p, coord, name: label, kind: p.kind ?? "pin" };
  });
}

export function mapBoundsPoints(data: {
  coordinates?: Coord[];
  segments?: Coord[][];
  pois?: MapPoint[];
  position?: Coord | null;
}) {
  const endpoints = (data.pois ?? []).filter(isEndpoint).map((p) => p.coord);
  const routePoints = [
    ...(data.coordinates ?? []),
    ...(data.segments ?? []).flat(),
  ];
  if (routePoints.length || endpoints.length) return [...routePoints, ...endpoints];
  const regularPois = (data.pois ?? []).map((p) => p.coord);
  return data.position ? [...regularPois, data.position] : regularPois;
}

export function mapInitialCenter(data: {
  coordinates?: Coord[];
  segments?: Coord[][];
  pois?: MapPoint[];
  position?: Coord | null;
}): Coord {
  return data.position ?? mapBoundsPoints(data)[0] ?? DEFAULT_MAP_CENTER;
}

export function lineFeatureData(coordinates: Coord[]) {
  return coordinates.length > 1
    ? {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates },
      }
    : emptyFeatureCollection;
}

export function routeGeometryData(data: {
  coordinates?: Coord[];
  segments?: Coord[][];
}) {
  return data.segments?.length
    ? {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "MultiLineString" as const,
          coordinates: data.segments,
        },
      }
    : lineFeatureData(data.coordinates ?? []);
}

export function accuracyCircleData(
  center?: Coord | null,
  radiusM?: number | null,
) {
  if (!center || !radiusM || radiusM <= 0) return emptyFeatureCollection;
  const points: Coord[] = [];
  const latScale = radiusM / 111_320;
  const lngScale =
    radiusM /
    (111_320 * Math.max(0.2, Math.cos((center[1] * Math.PI) / 180)));
  for (let i = 0; i <= 48; i += 1) {
    const angle = (i / 48) * Math.PI * 2;
    points.push([
      center[0] + Math.cos(angle) * lngScale,
      center[1] + Math.sin(angle) * latScale,
    ]);
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [points] },
  };
}
