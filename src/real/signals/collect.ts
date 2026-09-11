import { redactText } from "./redact.ts";
import { objectsToCsv, xlsxToObjects } from "./xlsx.ts";

export type CollectKind =
  | "json"
  | "xml"
  | "xlsx"
  | "xls"
  | "csv"
  | "html"
  | "empty"
  | "auth"
  | "unknown";

export type CollectResult = {
  kind: CollectKind;
  httpStatus: number;
  contentType: string;
  bytes: number;
  preview: string;
  regionMissing: boolean;
  records?: unknown;
  csv?: string;
  headers?: string[];
  error?: string;
};

const UTIC_AUTH = new Set(["20", "22", "30", "31", "32"]);

function sniffKind(status: number, contentType: string, buf: Uint8Array): CollectKind {
  if (status === 401 || status === 403) return "auth";
  if (!buf.length) return "empty";
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "xlsx";
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return "xls";
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, 256)).trim();
  const lower = contentType.toLowerCase();
  if (lower.includes("html") || /^<!doctype html/i.test(text) || /^<html/i.test(text))
    return "html";
  if (text.startsWith("{") || text.startsWith("[")) return "json";
  if (text.startsWith("<?xml") || text.startsWith("<")) return "xml";
  if (lower.includes("csv") || /^"?[A-Za-z0-9_]+"?[,;\t]/.test(text)) return "csv";
  return "unknown";
}

function previewOf(buf: Uint8Array, secrets: string[]): string {
  return redactText(new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, 240)), secrets);
}

function uticAuth(body: unknown): boolean {
  const rec = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const first = Array.isArray(body) ? body[0] : rec;
  if (!first || typeof first !== "object") return false;
  const code = String((first as Record<string, unknown>).resultCode ?? "");
  return UTIC_AUTH.has(code);
}

function regionMissing(body: unknown): boolean {
  if (Array.isArray(body) && body.length <= 1) {
    const head = body[0] as Record<string, unknown> | undefined;
    if (head && head.resultCode === "0" && body.length === 1) return true;
  }
  return false;
}

export function classifyCollected(
  status: number,
  contentType: string,
  buf: Uint8Array,
  secrets: string[] = [],
): CollectResult {
  const kind = sniffKind(status, contentType, buf);
  const base: CollectResult = {
    kind,
    httpStatus: status,
    contentType,
    bytes: buf.length,
    preview: previewOf(buf, secrets),
    regionMissing: false,
  };
  if (kind === "auth") return { ...base, error: "auth_failed" };
  if (kind === "empty") return { ...base, error: "empty_body" };
  if (kind === "html") return { ...base, error: "html_error_or_login_page" };
  if (kind === "xls") return { ...base, error: "xls_ole_export_csv" };
  if (kind === "xlsx") {
    try {
      const sheet = xlsxToObjects(buf);
      return {
        ...base,
        records: sheet.rows,
        headers: sheet.headers,
        csv: objectsToCsv(sheet.headers, sheet.rows),
      };
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : "xlsx_parse_failed" };
    }
  }
  if (kind === "json") {
    try {
      const body = JSON.parse(new TextDecoder("utf-8").decode(buf));
      if (uticAuth(body)) return { ...base, kind: "auth", error: "auth_failed", records: body };
      return { ...base, records: body, regionMissing: regionMissing(body) };
    } catch {
      return { ...base, error: "json_parse_failed" };
    }
  }
  return base;
}

export async function collectUrl(
  url: string,
  secrets: string[],
  fetcher: typeof fetch,
): Promise<CollectResult> {
  let response: Response;
  try {
    response = await fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return {
      kind: "empty",
      httpStatus: 0,
      contentType: "",
      bytes: 0,
      preview: "",
      regionMissing: false,
      error: "no_response",
    };
  }
  const buf = new Uint8Array(await response.arrayBuffer());
  return classifyCollected(
    response.status,
    response.headers.get("content-type") ?? "",
    buf,
    secrets,
  );
}
