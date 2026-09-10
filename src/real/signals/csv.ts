export type CsvTable = {
  headers: string[];
  rows: Record<string, string>[];
};

export function parseCsv(text: string): CsvTable {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      lines.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    lines.push(row);
  }
  const headers = (lines[0] ?? []).map((h) => h.trim());
  const rows = lines.slice(1).filter((r) => r.some((c) => c.trim() !== "")).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? "").trim();
    });
    return obj;
  });
  return { headers, rows };
}

export function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(",")),
  ].join("\n");
}

export function applyColumnMap(
  row: Record<string, string>,
  columns: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, header] of Object.entries(columns)) {
    out[field] = row[header] ?? row[field] ?? "";
  }
  for (const [k, v] of Object.entries(row)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}
