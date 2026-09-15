import { validCoord, type Coord } from "./core.ts";

export const LANDMARK_CATEGORIES = {
  station: "SW8",
  cafe: "CE7",
  restaurant: "FD6",
  convenience: "CS2",
  school: "SC4",
} as const;

export type LandmarkKind = keyof typeof LANDMARK_CATEGORIES;
export type Landmark = {
  id: string;
  name: string;
  coord: Coord;
  kind: LandmarkKind;
};

function isLandmarkKind(value: unknown): value is LandmarkKind {
  return typeof value === "string" && value in LANDMARK_CATEGORIES;
}

export function parseLandmarkKinds(raw: string | null): LandmarkKind[] {
  const allowed = new Set<string>(Object.keys(LANDMARK_CATEGORIES));
  const parts = (raw ?? "station,cafe,restaurant,convenience,school")
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is LandmarkKind => allowed.has(part));
  return [
    ...new Set(
      parts.length
        ? parts
        : (["station", "cafe", "restaurant", "convenience", "school"] as LandmarkKind[]),
    ),
  ];
}

export function asLandmark(value: unknown): Landmark | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Landmark>;
  if (
    !isLandmarkKind(row.kind) ||
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    !validCoord(row.coord)
  )
    return null;
  return {
    id: row.id.slice(0, 80),
    name: row.name.slice(0, 40),
    coord: row.coord,
    kind: row.kind,
  };
}

export function landmarkKindsForZoom(zoom: number): LandmarkKind[] {
  if (zoom < 12) return [];
  if (zoom < 13) return ["station"];
  if (zoom < 14) return ["station", "cafe", "restaurant"];
  return ["station", "cafe", "restaurant", "convenience", "school"];
}
