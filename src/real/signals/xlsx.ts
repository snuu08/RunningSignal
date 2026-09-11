import { inflateRawSync } from "node:zlib";

function u16(buf: Uint8Array, i: number): number {
  return buf[i]! | (buf[i + 1]! << 8);
}
function u32(buf: Uint8Array, i: number): number {
  return (
    (buf[i]! |
      (buf[i + 1]! << 8) |
      (buf[i + 2]! << 16) |
      (buf[i + 3]! << 24)) >>>
    0
  );
}

/** Local-file ZIP entries only. Data-descriptor (bit 3) files are refused. */
export function unzipLocalEntries(buf: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  let i = 0;
  while (i + 30 <= buf.length) {
    if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b) break;
    if (buf[i + 2] === 0x01 && buf[i + 3] === 0x02) break;
    if (buf[i + 2] !== 0x03 || buf[i + 3] !== 0x04) break;
    const flags = u16(buf, i + 6);
    if (flags & 0x8) throw new Error("zip_data_descriptor_unsupported");
    const method = u16(buf, i + 8);
    const compSize = u32(buf, i + 18);
    const nameLen = u16(buf, i + 26);
    const extraLen = u16(buf, i + 28);
    const name = new TextDecoder("utf-8").decode(buf.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extraLen;
    const packed = buf.subarray(start, start + compSize);
    const data =
      method === 0
        ? packed
        : method === 8
          ? inflateRawSync(packed)
          : (() => {
              throw new Error(`zip_method_${method}`);
            })();
    out.set(name.replace(/\\/g, "/"), data);
    i = start + compSize;
  }
  return out;
}

function xmlText(node: string): string {
  return node
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const texts = [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((x) =>
      xmlText(x[1]),
    );
    out.push(texts.join(""));
  }
  return out;
}

function colRow(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

/**
 * First worksheet to objects. All values stay strings so leading zeros survive.
 * Does not execute formulas.
 */
export function xlsxToObjects(buf: Uint8Array): {
  sheet: string;
  headers: string[];
  rows: Record<string, string>[];
} {
  const files = unzipLocalEntries(buf);
  const sstFile =
    files.get("xl/sharedStrings.xml") ?? files.get("xl/SharedStrings.xml");
  const sst = sstFile ? sharedStrings(new TextDecoder("utf-8").decode(sstFile)) : [];
  const sheetName =
    [...files.keys()].find((k) => /^xl\/worksheets\/sheet1\.xml$/i.test(k)) ??
    [...files.keys()].find((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k));
  if (!sheetName) throw new Error("xlsx_sheet_missing");
  const xml = new TextDecoder("utf-8").decode(files.get(sheetName)!);
  const grid = new Map<string, string>();
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml))) {
    const attrs = m[1];
    const body = m[2];
    const ref = /r="([^"]+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    const t = /t="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
    const is = /<is>([\s\S]*?)<\/is>/.exec(body)?.[1];
    let value = "";
    if (t === "s") value = sst[Number(v)] ?? "";
    else if (t === "inlineStr" || is) {
      const texts = [...(is ?? body).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map(
        (x) => xmlText(x[1]),
      );
      value = texts.join("");
    } else value = xmlText(v);
    grid.set(ref.toUpperCase(), value);
  }
  let maxRow = 0;
  let maxCol = 0;
  for (const ref of grid.keys()) {
    const pos = colRow(ref);
    if (!pos) continue;
    maxRow = Math.max(maxRow, pos.row);
    maxCol = Math.max(maxCol, pos.col);
  }
  const colLetter = (n: number) => {
    let s = "";
    let x = n;
    while (x > 0) {
      const r = (x - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  };
  const headers: string[] = [];
  for (let c = 1; c <= maxCol; c++) {
    const h = grid.get(`${colLetter(c)}1`)?.trim() || `col_${c}`;
    headers.push(h);
  }
  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= maxRow; r++) {
    const rec: Record<string, string> = {};
    let empty = true;
    headers.forEach((h, i) => {
      const v = grid.get(`${colLetter(i + 1)}${r}`) ?? "";
      rec[h] = v;
      if (v) empty = false;
    });
    if (!empty) rows.push(rec);
  }
  return { sheet: sheetName, headers, rows };
}

export function objectsToCsv(headers: string[], rows: Record<string, string>[]): string {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [headers.map(cell).join(","), ...rows.map((r) => headers.map((h) => cell(r[h] ?? "")).join(","))].join(
    "\n",
  );
}
