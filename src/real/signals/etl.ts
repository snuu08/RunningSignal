import { parseCsv, applyColumnMap } from "./csv.ts";
import { toWgs84 } from "./geo-crs.ts";
import { isCrossingGeometry, namespacedId, type Exclusion } from "./schema.ts";
import {
  collectValidated,
  validateCrossing,
  validateObservation,
  validatePlan,
} from "./validate.ts";

export type MappingFile = {
  synthetic?: boolean;
  source: string;
  crs: string;
  geometryType: string;
  columns: Record<string, string>;
};

export type EtlReport = {
  kind: string;
  inputRows: number;
  kept: number;
  exclusions: Exclusion[];
  upserts: number;
  records: unknown[];
};

function upsertBy<T>(
  items: T[],
  keyOf: (item: T) => string,
  exclusions: Exclusion[],
): T[] {
  const map = new Map<string, T>();
  items.forEach((item, i) => {
    const key = keyOf(item);
    if (map.has(key)) {
      exclusions.push({ row: i + 2, reason: "duplicate_upsert_key", sourceId: key });
    }
    map.set(key, item);
  });
  return [...map.values()];
}

export function etlCrossings(csvText: string, mapping: MappingFile): EtlReport {
  const table = parseCsv(csvText);
  const mapped: Record<string, unknown>[] = table.rows.map((row) => {
    const m = applyColumnMap(row, mapping.columns);
    return {
      ...m,
      source: m.source || mapping.source,
      geometryType: m.geometryType || mapping.geometryType,
      synthetic: mapping.synthetic === true || m.synthetic === "true",
      stage: "normalized",
    };
  });
  const crs = mapping.crs;
  const exclusions: Exclusion[] = [];
  const projected: Record<string, unknown>[] = [];
  mapped.forEach((row, i) => {
    const geom = String(row.geometryType);
    if (isCrossingGeometry(geom)) {
      const entry = toWgs84(Number(row.entryLon ?? row.entryX), Number(row.entryLat ?? row.entryY), crs);
      const exit = toWgs84(Number(row.exitLon ?? row.exitX), Number(row.exitLat ?? row.exitY), crs);
      if (!entry.coord) {
        exclusions.push({ row: i + 2, reason: entry.reason ?? "entry_crs", sourceId: String(row.sourceCrossingId) });
        return;
      }
      if (!exit.coord) {
        exclusions.push({ row: i + 2, reason: exit.reason ?? "exit_crs", sourceId: String(row.sourceCrossingId) });
        return;
      }
      projected.push({
        ...row,
        entryLon: entry.coord[0],
        entryLat: entry.coord[1],
        exitLon: exit.coord[0],
        exitLat: exit.coord[1],
      });
      return;
    }
    const pt = toWgs84(Number(row.lon ?? row.x), Number(row.lat ?? row.y), crs);
    if (!pt.coord) {
      exclusions.push({ row: i + 2, reason: pt.reason ?? "point_crs", sourceId: String(row.sourceCrossingId) });
      return;
    }
    if (row.cycleSec || row.entryStartSec || row.greenSec) {
      exclusions.push({
        row: i + 2,
        reason: "location_row_must_not_invent_plan",
        sourceId: String(row.sourceCrossingId),
      });
      return;
    }
    projected.push({
      ...row,
      lon: pt.coord[0],
      lat: pt.coord[1],
      entryLon: pt.coord[0],
      entryLat: pt.coord[1],
      exitLon: pt.coord[0],
      exitLat: pt.coord[1],
    });
  });
  const parsed = collectValidated(projected, validateCrossing);
  exclusions.push(...parsed.exclusions);
  const facilities = parsed.records.filter((r) => !isCrossingGeometry(r.geometryType));
  const crossings = parsed.records.filter((r) => isCrossingGeometry(r.geometryType));
  const upserted = upsertBy(
    [...facilities, ...crossings],
    (r) => r.internalId,
    exclusions,
  );
  return {
    kind: "crossings",
    inputRows: table.rows.length,
    kept: upserted.length,
    exclusions,
    upserts: upserted.length,
    records: upserted,
  };
}

export function etlPlans(csvText: string, mapping: MappingFile): EtlReport {
  const table = parseCsv(csvText);
  const mapped = table.rows.map((row) => ({
    ...applyColumnMap(row, mapping.columns),
    source: mapping.source,
    synthetic: mapping.synthetic === true,
    stage: "normalized",
  }));
  const parsed = collectValidated(mapped, validatePlan);
  const upserted = upsertBy(
    parsed.records,
    (p) => namespacedId(p.source, `${p.sourcePlanId}@${p.version}`),
    parsed.exclusions,
  );
  return {
    kind: "plans",
    inputRows: table.rows.length,
    kept: upserted.length,
    exclusions: parsed.exclusions,
    upserts: upserted.length,
    records: upserted,
  };
}

export function etlObservations(csvText: string): EtlReport {
  const table = parseCsv(csvText);
  const parsed = collectValidated(table.rows, validateObservation);
  return {
    kind: "observations",
    inputRows: table.rows.length,
    kept: parsed.records.length,
    exclusions: parsed.exclusions,
    upserts: parsed.records.length,
    records: parsed.records,
  };
}

export function etlGeoJson(
  geojson: { type?: string; features?: { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[] },
  mapping: MappingFile,
): EtlReport {
  const exclusions: Exclusion[] = [];
  const rows: Record<string, unknown>[] = [];
  (geojson.features ?? []).forEach((f, i) => {
    const g = f.geometry;
    const props = { ...(f.properties ?? {}), source: mapping.source, geometryType: mapping.geometryType, synthetic: mapping.synthetic === true, stage: "normalized" };
    if (g?.type === "Point" && Array.isArray(g.coordinates)) {
      const [x, y] = g.coordinates as number[];
      const wgs = toWgs84(x, y, mapping.crs);
      if (!wgs.coord) {
        exclusions.push({ row: i + 1, reason: wgs.reason ?? "crs" });
        return;
      }
      rows.push({ ...props, lon: wgs.coord[0], lat: wgs.coord[1] });
      return;
    }
    if (g?.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
      const a = g.coordinates[0] as number[];
      const b = g.coordinates.at(-1) as number[];
      const entry = toWgs84(a[0], a[1], mapping.crs);
      const exit = toWgs84(b[0], b[1], mapping.crs);
      if (!entry.coord || !exit.coord) {
        exclusions.push({ row: i + 1, reason: "linestring_crs" });
        return;
      }
      rows.push({
        ...props,
        geometryType: props.geometryType || "crossing-line",
        entryLon: entry.coord[0],
        entryLat: entry.coord[1],
        exitLon: exit.coord[0],
        exitLat: exit.coord[1],
      });
      return;
    }
    exclusions.push({ row: i + 1, reason: "unsupported_geometry" });
  });
  const parsed = collectValidated(rows, validateCrossing);
  exclusions.push(...parsed.exclusions);
  return {
    kind: "geojson",
    inputRows: geojson.features?.length ?? 0,
    kept: parsed.records.length,
    exclusions,
    upserts: parsed.records.length,
    records: parsed.records,
  };
}

export function rejectSpreadsheetFilename(name: string): string | null {
  if (/\.xlsx?$/i.test(name))
    return "xls_not_parsed_export_csv";
  return null;
}
