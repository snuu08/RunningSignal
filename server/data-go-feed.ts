import { parseRetryAfter, type LiveCallClass } from "../src/real/signals/tdata.ts";
import { redactValue } from "../src/real/signals/redact.ts";
import { XMLParser, XMLValidator } from "fast-xml-parser";

// Paths and query names from data.go.kr's 15157604 Swagger and 15056721
// operation table, checked 2026-10-17. IDs are provider-specific namespaces.
export const DATA_GO_SERVICES = {
  current: { path: "B551982/rti/tl_drct_info", keyParam: "serviceKey", regionParam: "stdgCd" },
  map: { path: "B551982/rti/crsrd_map_info", keyParam: "serviceKey", regionParam: "stdgCd" },
  "police-crossroad": { path: "1320000/CrossRoadInfoService/getCrossRoadInfoList",
    keyParam: "ServiceKey", regionParam: "srchCTid" },
} as const;
export type DataGoService = keyof typeof DATA_GO_SERVICES;
type Row = Record<string, unknown>;
type DataGoResult = {
  class: LiveCallClass;
  httpStatus: number | null;
  resultCode: string | null;
  fetchedAt: number;
  totalCount: number | null;
  rows: Row[];
  retryAfterMs: number | null;
  responseFormat?: "json" | "xml" | "unknown";
};
const record = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const ROW_FIELDS = /^(stdgCd|lclgvNm|crsrdId|crsrdNm|mapCtptIntLat|mapCtptIntLot|laneWdth|lmtSpdTypeNm|lmtSpd|crsrdEngNm|totDt|regDt|REGION_CD|INT_NO|INT_NM|X_COORD|Y_COORD|UPD_DTIME)$|^(nt|et|st|wt|ne|se|sw|nw)Pdsg(RmndCs|SttsNm)$/;

function parseBody(text: string): { body: unknown; format: "json" | "xml" | "unknown" } {
  try { return { body: JSON.parse(text), format: "json" }; } catch { /* some legacy services return XML */ }
  if (text.length <= 2_000_000 && !/<!DOCTYPE|<!ENTITY/i.test(text) &&
    XMLValidator.validate(text) === true) {
    return { body: new XMLParser({ parseTagValue: false, ignoreAttributes: true }).parse(text), format: "xml" };
  }
  return { body: null, format: "unknown" };
}

export function createDataGoFeedClient(secret: string, fetcher: typeof fetch, nowMs = () => Date.now()) {
  // This is a diagnostic snapshot, never the runner's live countdown. Sharing
  // calls for 60 seconds avoids spending the daily quota on repeated checks.
  const calls = new Map<string, { until: number; value: Promise<DataGoResult> }>();
  let blockedUntil = 0;
  async function read(service: DataGoService, region: string, pageNo: string): Promise<DataGoResult> {
    const base = { httpStatus: null, resultCode: null, fetchedAt: nowMs(),
      totalCount: null, rows: [], retryAfterMs: null };
    if (blockedUntil > nowMs()) return { ...base, class: "rate-limited", retryAfterMs: blockedUntil - nowMs() };
    const cacheKey = `${service}:${region}:${pageNo}`;
    const saved = calls.get(cacheKey);
    if (saved && saved.until > nowMs()) return saved.value;
    if (calls.size >= 64) calls.delete(calls.keys().next().value!);
    const entry = { until: Infinity, value: null as unknown as Promise<DataGoResult> };
    entry.value = (async (): Promise<DataGoResult> => {
      let key: string;
      try {
        // Accept either portal form, then URLSearchParams encodes exactly once.
        key = decodeURIComponent(secret.trim());
      } catch { return { ...base, class: "auth" }; }
      const spec = DATA_GO_SERVICES[service];
      const query = new URLSearchParams({ [spec.keyParam]: key, [spec.regionParam]: region,
        pageNo, numOfRows: "20", type: "json" });
      try {
        const response = await fetcher(`https://apis.data.go.kr/${spec.path}?${query}`, {
          redirect: "error", signal: AbortSignal.timeout(12_000),
        });
        const parsed = parseBody(await response.text());
        const root = record(parsed.body);
        const envelope = record(root.response ?? root.Response ?? root);
        const header = record(envelope.header ?? envelope);
        const gateway = record(record(root.OpenAPI_ServiceResponse).cmmMsgHeader);
        const rawCode = gateway.returnReasonCode ?? header.resultCode;
        const code = (typeof rawCode === "string" || typeof rawCode === "number") &&
          /^(K)?\d{1,3}$/.test(String(rawCode)) ? String(rawCode) : null;
        const numeric = code?.replace(/^K/, "");
        const limited = response.status === 429 || numeric === "22" || numeric === "23";
        const delay = limited ? Math.max(60_000, parseRetryAfter(response.headers.get("retry-after"), nowMs()) ?? 0) : null;
        if (delay !== null) blockedUntil = nowMs() + delay;
        const auth = response.status === 401 || response.status === 403 ||
          ["20", "21", "30", "31", "32", "33"].includes(numeric ?? "");
        const ok = response.ok && ["0", "00", "03"].includes(numeric ?? "");
        const data = record(envelope.body ?? envelope);
        const items = record(data.items);
        const rawRows = items.item ?? (Array.isArray(data.items) ? data.items : []);
        const rows = (Array.isArray(rawRows) ? rawRows : [rawRows]).slice(0, 20).map(record)
          .map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => ROW_FIELDS.test(k) &&
            (typeof v === "string" || typeof v === "number" || v === null))))
          .filter((r) => Object.keys(r).length > 0);
        const count = Number(data.totalCount);
        return { class: limited ? "rate-limited" : auth ? "auth" : !ok ? "spec-unknown" : rows.length ? "ok-data" : "ok-empty",
          httpStatus: response.status, resultCode: code, fetchedAt: nowMs(),
          totalCount: ok && data.totalCount != null && Number.isSafeInteger(count) && count >= 0 ? count : null,
          rows: ok ? redactValue(rows, [key, encodeURIComponent(key), secret]) as Row[] : [],
          retryAfterMs: delay, responseFormat: parsed.format };
      } catch { return { ...base, class: "connect" }; }
    })().then((result) => { entry.until = nowMs() + 60_000; return result; });
    calls.set(cacheKey, entry);
    return entry.value;
  }
  return { read };
}

let clients = new WeakMap<typeof fetch, { secret: string; client: ReturnType<typeof createDataGoFeedClient> }>();
export function dataGoFeedClient(secret: string, fetcher: typeof fetch) {
  let saved = clients.get(fetcher);
  if (!saved || saved.secret !== secret) {
    saved = { secret, client: createDataGoFeedClient(secret, fetcher) };
    clients.set(fetcher, saved);
  }
  return saved.client;
}
export function resetDataGoFeedClientsForTests() { clients = new WeakMap(); }
