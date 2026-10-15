import { createHash } from "node:crypto";
import { parseCsv } from "./csv.ts";

export const MAP_CATALOG_COLUMNS = {
  centers: ["itstId", "itstNm", "mapCtptIntLat", "mapCtptIntLot"],
  lanes: ["itstId", "laneId", "laneTypeCd"],
  nodes: ["itstId", "laneId", "nodeOrdr", "ofstXaxsCrdnt", "ofstYaxsCrdnt"],
  connections: ["itstId", "laneId", "laneCnncId", "signlgroupCd"],
} as const;

export type MapCatalogKind = keyof typeof MAP_CATALOG_COLUMNS;
const kinds = Object.keys(MAP_CATALOG_COLUMNS) as MapCatalogKind[];

/** File coverage only. Names, offsets and group codes are never prediction inputs here. */
export function auditMapCatalog(
  inputs: Partial<Record<MapCatalogKind, Uint8Array>>,
  targetIds: string[] = [],
) {
  const tables = kinds.map((kind) => {
    const bytes = inputs[kind];
    if (!bytes) return { kind, table: null, bytes: null, sha256: null };
    const table = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const missing = MAP_CATALOG_COLUMNS[kind].filter((column) => !table.headers.includes(column));
    if (missing.length) throw new Error(`catalog_columns_missing:${kind}:${missing.join(",")}`);
    return { kind, table, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  const idSets = tables.map(({ table }) => table ? new Set(table.rows.map((r) => r.itstId).filter(Boolean)) : null);
  const idsPresentInAllFourFiles = idSets.every((ids) => ids !== null)
    ? [...idSets[0]!].filter((id) => idSets.every((ids) => ids!.has(id))).sort()
    : null;
  return {
    stage: "raw" as const,
    predictionReady: false as const,
    coverageMeaning: "presence_in_downloaded_files_only",
    files: tables.map(({ kind, table, bytes, sha256 }, i) => ({
      kind,
      supplied: table !== null,
      bytes,
      sha256,
      headers: table?.headers ?? null,
      rows: table?.rows.length ?? null,
      intersections: idSets[i]?.size ?? null,
    })),
    idsPresentInAllFourFiles,
    targets: [...new Set(targetIds)].map((itstId) => {
      const rows = Object.fromEntries(tables.map(({ kind, table }) => [
        kind, table ? table.rows.filter((row) => row.itstId === itstId).length : null,
      ])) as Record<MapCatalogKind, number | null>;
      const center = tables.find(({ kind }) => kind === "centers")?.table;
      return {
        itstId,
        names: center ? [...new Set(center.rows.filter((r) => r.itstId === itstId).map((r) => r.itstNm))] : null,
        rows,
        presentInAllFourFiles: kinds.every((kind) => rows[kind] !== null && rows[kind]! > 0),
      };
    }),
    limitations: [
      "An absent ID is absent from this file; it does not prove absence from the provider's complete dataset.",
      "Presence in all files does not establish complete lanes, crossing geometry, pedestrian group mapping or an operating plan.",
      "No cross-provider ID, lane type, coordinate unit, CRS or API direction is inferred.",
    ],
  };
}
