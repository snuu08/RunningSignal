import { validCoord, type Coord } from "../core.ts";

export type CrsCode = "EPSG:4326" | "WGS84" | "EPSG:5186";

const GRS80_A = 6378137;
const GRS80_F = 1 / 298.257222101;

/** Korea 2000 / Central Belt. GRS80; treat as WGS84-adjacent, not survey grade. */
export function fromEpsg5186(easting: number, northing: number): Coord | null {
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) return null;
  const a = GRS80_A;
  const f = GRS80_F;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ep2 = (a * a - b * b) / (b * b);
  const k0 = 1;
  const lon0 = (127 * Math.PI) / 180;
  const lat0 = (38 * Math.PI) / 180;
  const mer = (phi: number) =>
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) *
        Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = easting - 200000;
  const m = mer(lat0) + (northing - 600000) / k0;
  const mu =
    m / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const fp =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sinF = Math.sin(fp);
  const cosF = Math.cos(fp);
  const tanF = Math.tan(fp);
  const c1 = ep2 * cosF * cosF;
  const t1 = tanF * tanF;
  const n1 = a / Math.sqrt(1 - e2 * sinF * sinF);
  const r1 = (a * (1 - e2)) / (1 - e2 * sinF * sinF) ** 1.5;
  const d = x / (n1 * k0);
  const lat =
    fp -
    ((n1 * tanF) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) *
          d ** 6) /
          720);
  const lon =
    lon0 +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) /
        120) /
      cosF;
  const coord: Coord = [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
  return validCoord(coord) ? coord : null;
}

export function toWgs84(
  x: number,
  y: number,
  crs: string,
): { coord: Coord | null; reason: string | null } {
  const code = crs.trim().toUpperCase().replace(" ", "");
  if (code === "EPSG:4326" || code === "WGS84") {
    const coord: Coord = [x, y];
    return validCoord(coord)
      ? { coord, reason: null }
      : { coord: null, reason: "wgs84_out_of_range" };
  }
  if (code === "EPSG:5186") {
    const coord = fromEpsg5186(x, y);
    return coord
      ? { coord, reason: null }
      : { coord: null, reason: "epsg5186_convert_failed" };
  }
  return { coord: null, reason: `unsupported_crs:${crs}` };
}
