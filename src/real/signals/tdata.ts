import { PROVIDER_CONTRACTS } from "./contracts.ts";

export const TDATA_GATEWAY =
  "https://t-data.seoul.go.kr/apig/apiman-gateway/tapi";

export type TdataCallId = "phase" | "timing" | "connection" | "lane";

export const TDATA_CALLABLE: Record<
  TdataCallId,
  {
    path: string;
    dataId: string;
    itstIdListed: boolean;
  }
> = {
  phase: {
    path: "v2xSignalPhaseInformation",
    dataId: "10119",
    itstIdListed: true,
  },
  timing: {
    path: "v2xSignalPhaseTimingInformation",
    dataId: "10120",
    itstIdListed: true,
  },
  connection: {
    path: "v2xSignalConnectionMapInformation",
    dataId: "10123",
    itstIdListed: false,
  },
  lane: {
    path: "v2xLaneMapInformation",
    dataId: "10122",
    itstIdListed: false,
  },
};

export const TDATA_FILE_ONLY = {
  crossroad: {
    path: "v2xCrossroadMapInformation",
    dataId: "10144",
    catalogUrl:
      "https://t-data.seoul.go.kr/dataprovide/trafficdataviewfile.do?data_id=10144",
  },
} as const;

/**
 * Portal field Korean name is 센티초; the value-description column is 1/10초.
 * Do not convert remaining *RmdrCs into seconds until a live sample is measured.
 */
export const TDATA_RMDR_UNIT_CONFLICT =
  "label=센티초; value_description=1/10초; conversion=unverified";

/** Display delay flag for current-state rows. Not an applied-plan clock and not a cycle. */
export const CURRENT_STATE_STALE_MS = 60_000;

const PED_STAT = /^(nt|et|st|wt|ne|se|sw|nw)PdsgStatNm$/;
const PED_REMAIN = /^(nt|et|st|wt|ne|se|sw|nw)PdsgRmdrCs$/;
const VEH_STAT = /^(nt|et|st|wt|ne|se|sw|nw)(Stsg|Ltsg|Utsg|Bssg|Bcsg)StatNm$/;

const DIR_KO: Record<string, string> = {
  nt: "북쪽",
  et: "동쪽",
  st: "남쪽",
  wt: "서쪽",
  ne: "북동",
  se: "남동",
  sw: "남서",
  nw: "북서",
};

export type PhaseField = {
  key: string;
  direction: string;
  kind: "pedestrian" | "vehicle";
  statusName: string;
};

export type RemainingField = {
  key: string;
  direction: string;
  raw: number | null;
  seconds: null;
  unit: typeof TDATA_RMDR_UNIT_CONFLICT;
  missing: boolean;
};

export type CurrentStateView = {
  itstId: string | null;
  sourceTimestampMs: number | null;
  fetchedAtMs: number;
  sourceAgeMs: number | null;
  stale: boolean;
  missingSourceTime: boolean;
  pedestrian: PhaseField[];
  vehicle: PhaseField[];
  remainingPedestrian: RemainingField[];
  pedestrianPresent: boolean;
  remainingPresent: boolean;
  notes: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value.find((row) => row && typeof row === "object");
    return first && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : null;
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const WRAP_KEYS = ["items", "data", "list", "body", "item", "row", "rows"];

export function rowsOf(body: unknown, depth = 0): Record<string, unknown>[] {
  if (body == null || depth > 6) return [];
  if (Array.isArray(body)) {
    return body.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      if (Array.isArray(row)) return rowsOf(row, depth + 1);
      const rec = row as Record<string, unknown>;
      if (
        "itstId" in rec ||
        Object.keys(rec).some(
          (k) => k.endsWith("PdsgStatNm") || k.endsWith("PdsgRmdrCs"),
        )
      )
        return [rec];
      return rowsOf(rec, depth + 1);
    });
  }
  const rec = asRecord(body);
  if (!rec) return [];
  for (const key of WRAP_KEYS) {
    if (rec[key] == null) continue;
    const nested = rowsOf(rec[key], depth + 1);
    if (nested.length) return nested;
  }
  if (
    "itstId" in rec ||
    Object.keys(rec).some(
      (k) => k.endsWith("PdsgStatNm") || k.endsWith("PdsgRmdrCs"),
    )
  )
    return [rec];
  return [];
}

export type LiveCallClass =
  | "ok-data"
  | "ok-empty"
  | "auth"
  | "connect"
  | "spec-unknown"
  | "region-unavailable";

export type TdataFetchResult = {
  service: TdataCallId;
  itstId: string | null;
  class: LiveCallClass;
  httpStatus: number | null;
  requestedAtMs: number;
  respondedAtMs: number | null;
  lagMs: number | null;
  error: string | null;
  rowCount: number;
  itstIds: string[];
  pedestrianKeys: string[];
  remainingKeys: string[];
  requestUrlRedacted: string;
  body: unknown;
};

function classifyHttp(
  httpStatus: number | null,
  error: string | null,
  rowCount: number,
  body: unknown,
): LiveCallClass {
  if (
    error === "TimeoutError" ||
    error === "AbortError" ||
    error === "TypeError" ||
    httpStatus === 0 ||
    httpStatus === null
  )
    return "connect";
  if (httpStatus === 401 || httpStatus === 403) return "auth";
  const rec = asRecord(body);
  const msg = JSON.stringify(body ?? "").toLowerCase();
  if (
    /invalid[_ ]?(api|service)?[_ ]?key|unauthorized|access.?denied|not registered/.test(
      msg,
    )
  )
    return "auth";
  if (httpStatus === 404) return "spec-unknown";
  if (httpStatus === 502 || httpStatus === 504) return "connect";
  if (httpStatus >= 200 && httpStatus < 300) {
    if (rowCount > 0) return "ok-data";
    if (rec && (rec.resultCode === "0" || rec.RESULTCODE === "00"))
      return "ok-empty";
    return "ok-empty";
  }
  return "spec-unknown";
}

export async function fetchTdataService(
  service: TdataCallId,
  apiKey: string,
  fetcher: typeof fetch,
  opts: { itstId?: string; pageNo?: string; numOfRows?: string } = {},
): Promise<TdataFetchResult> {
  const spec = TDATA_CALLABLE[service];
  const query = new URLSearchParams({
    apiKey,
    type: "json",
    pageNo: opts.pageNo ?? "1",
    numOfRows: opts.numOfRows ?? "20",
  });
  if (opts.itstId && spec.itstIdListed) query.set("itstId", opts.itstId);
  const url = tdataUrl(service, query);
  const requestedAtMs = Date.now();
  const base = {
    service,
    itstId: opts.itstId ?? null,
    requestUrlRedacted: url.replace(apiKey, "[redacted]"),
    requestedAtMs,
  };
  try {
    const response = await fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const respondedAtMs = Date.now();
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      body = { nonJson: true, preview: text.slice(0, 200) };
    }
    const rows = rowsOf(body);
    const itstIds = [
      ...new Set(
        rows
          .map((r) => (r.itstId != null ? String(r.itstId) : ""))
          .filter(Boolean),
      ),
    ];
    const pedestrianKeys = [
      ...new Set(
        rows.flatMap((r) =>
          Object.entries(r)
            .filter(
              ([k, v]) =>
                /PdsgStatNm$/.test(k) && v != null && String(v).trim() !== "",
            )
            .map(([k]) => k),
        ),
      ),
    ];
    const remainingKeys = [
      ...new Set(
        rows.flatMap((r) =>
          Object.entries(r)
            .filter(
              ([k, v]) =>
                /PdsgRmdrCs$/.test(k) && v != null && String(v).trim() !== "",
            )
            .map(([k]) => k),
        ),
      ),
    ];
    const htmlAuth =
      typeof body === "object" &&
      body !== null &&
      "nonJson" in body &&
      response.status === 200;
    return {
      ...base,
      class: htmlAuth
        ? "spec-unknown"
        : classifyHttp(response.status, null, rows.length, body),
      httpStatus: response.status,
      respondedAtMs,
      lagMs: respondedAtMs - requestedAtMs,
      error: htmlAuth ? "non_json_body" : null,
      rowCount: rows.length,
      itstIds,
      pedestrianKeys,
      remainingKeys,
      body,
    };
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    return {
      ...base,
      class: "connect",
      httpStatus: null,
      respondedAtMs: null,
      lagMs: null,
      error: name,
      rowCount: 0,
      itstIds: [],
      pedestrianKeys: [],
      remainingKeys: [],
      body: null,
    };
  }
}

export function interpretCurrentState(
  body: unknown,
  fetchedAtMs: number,
  kind: "phase" | "timing",
): CurrentStateView {
  const row = rowsOf(body)[0] ?? {};
  const itstId = row.itstId != null ? String(row.itstId) : null;
  const ts = row.trsmUtcTime ?? row.regDt;
  const sourceTimestampMs =
    typeof ts === "number" && Number.isFinite(ts)
      ? ts
      : Number.isFinite(Number(ts))
        ? Number(ts)
        : null;
  const sourceAgeMs =
    sourceTimestampMs !== null ? fetchedAtMs - sourceTimestampMs : null;
  const pedestrian: PhaseField[] = [];
  const vehicle: PhaseField[] = [];
  const remainingPedestrian: RemainingField[] = [];
  for (const [key, value] of Object.entries(row)) {
    const ped = PED_STAT.exec(key);
    if (ped) {
      const statusName = value == null || value === "" ? "" : String(value).trim();
      if (statusName)
        pedestrian.push({
          key,
          direction: DIR_KO[ped[1]] ?? ped[1],
          kind: "pedestrian",
          statusName,
        });
      continue;
    }
    const veh = VEH_STAT.exec(key);
    if (veh) {
      const statusName = value == null || value === "" ? "" : String(value).trim();
      if (statusName)
        vehicle.push({
          key,
          direction: DIR_KO[veh[1]] ?? veh[1],
          kind: "vehicle",
          statusName,
        });
      continue;
    }
    const rem = PED_REMAIN.exec(key);
    if (rem) {
      const parsed = remainingRawCs(value);
      remainingPedestrian.push({
        key,
        direction: DIR_KO[rem[1]] ?? rem[1],
        raw: parsed.raw,
        seconds: null,
        unit: parsed.unit,
        missing: parsed.raw === null,
      });
    }
  }
  const notes: string[] = [];
  if (kind === "phase" && !pedestrian.length)
    notes.push("보행신호 상태명이 비어 있거나 이 행에 없습니다.");
  if (kind === "timing" && remainingPedestrian.every((r) => r.missing))
    notes.push("보행 잔여 *PdsgRmdrCs 값이 없습니다. 0초로 보지 않습니다.");
  if (sourceTimestampMs === null) notes.push("원천 시각(trsmUtcTime)이 없습니다.");
  else if (sourceAgeMs !== null && sourceAgeMs > CURRENT_STATE_STALE_MS)
    notes.push("원천 시각이 수신보다 60초 이상 이전입니다. 지연된 현재 상태로 표시합니다.");
  notes.push("잔여값은 초로 바꾸지 않습니다. 현재 상태가 끝나는 시간과 보행 초록까지를 구분하지 못한 상태입니다.");
  notes.push("이 교차로 ID만으로는 특정 횡단 양끝점·진행 방향에 대응하지 않습니다.");
  return {
    itstId,
    sourceTimestampMs,
    fetchedAtMs,
    sourceAgeMs,
    stale: sourceAgeMs !== null && sourceAgeMs > CURRENT_STATE_STALE_MS,
    missingSourceTime: sourceTimestampMs === null,
    pedestrian,
    vehicle,
    remainingPedestrian,
    pedestrianPresent: pedestrian.length > 0,
    remainingPresent: remainingPedestrian.some((r) => !r.missing),
    notes,
  };
}

export function remainingRawCs(raw: unknown): {
  raw: number | null;
  seconds: null;
  unit: typeof TDATA_RMDR_UNIT_CONFLICT;
} {
  if (raw === "" || raw == null) {
    return { raw: null, seconds: null, unit: TDATA_RMDR_UNIT_CONFLICT };
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  return {
    raw: Number.isFinite(n) ? n : null,
    seconds: null,
    unit: TDATA_RMDR_UNIT_CONFLICT,
  };
}

export function tdataUrl(
  service: TdataCallId,
  query: URLSearchParams,
): string {
  return `${TDATA_GATEWAY}/${TDATA_CALLABLE[service].path}/1.0?${query}`;
}

export function contrastInCodeUrl(service: string, usedUrl: string) {
  if (service === "crossroad") {
    return {
      service,
      usedUrl,
      officialKind: "file" as const,
      match: false,
      detail: TDATA_FILE_ONLY.crossroad.catalogUrl,
    };
  }
  const spec = TDATA_CALLABLE[service as TdataCallId];
  const contract = PROVIDER_CONTRACTS.find((c) => c.id === `tdata-${service}`);
  if (!spec || !contract?.listedEndpoint) {
    return {
      service,
      usedUrl,
      officialKind: "unknown" as const,
      match: false,
      detail: "no listed Open API",
    };
  }
  const listed = new URL(contract.listedEndpoint);
  const used = new URL(usedUrl.split("?")[0]);
  const pathMatch =
    used.hostname === "t-data.seoul.go.kr" &&
    used.pathname === listed.pathname;
  return {
    service,
    usedUrl: used.toString(),
    officialKind: "openapi" as const,
    match: pathMatch && used.protocol === "https:",
    detail: pathMatch
      ? listed.protocol === "http:"
        ? "path matches official sample; scheme upgraded to https"
        : "path matches"
      : `path differs from ${listed.pathname}`,
  };
}

export type CaptureCall = {
  service: TdataCallId;
  itstId: string;
  requestUrlRedacted: string;
  requestedAtMs: number;
  respondedAtMs: number;
  httpStatus: number;
  sourceTimestampMs: number | null;
  responseVersion: string | null;
  lagMs: number;
  sourceAgeMs: number | null;
  itstIdOnOfficialRequestTable: boolean;
  body: unknown;
};

export type CaptureSession = {
  synthetic: false;
  itstId: string;
  capturedAtMs: number;
  callGapMs: Record<string, number>;
  calls: CaptureCall[];
};

function sourceMeta(body: unknown): {
  sourceTimestampMs: number | null;
  responseVersion: string | null;
} {
  const rec = rowsOf(body)[0];
  if (!rec) return { sourceTimestampMs: null, responseVersion: null };
  const ts = rec.trsmUtcTime ?? rec.regDt;
  const n = typeof ts === "number" ? ts : Number(ts);
  return {
    sourceTimestampMs: Number.isFinite(n) ? n : null,
    responseVersion:
      rec.dataId != null
        ? String(rec.dataId)
        : rec.regDt != null
          ? String(rec.regDt)
          : null,
  };
}

export async function captureTdataIntersection(
  itstId: string,
  apiKey: string,
  fetcher: typeof fetch,
  services: TdataCallId[] = ["phase", "timing", "connection", "lane"],
): Promise<CaptureSession> {
  if (!/^\d{1,10}$/.test(itstId)) throw new Error("invalid itstId");
  const calls: CaptureCall[] = [];
  let prevAt = 0;
  const gaps: Record<string, number> = {};
  for (const service of services) {
    const spec = TDATA_CALLABLE[service];
    const query = new URLSearchParams({
      apiKey,
      type: "json",
      pageNo: "1",
      numOfRows: "10",
    });
    if (spec.itstIdListed) query.set("itstId", itstId);
    const url = tdataUrl(service, query);
    const requestedAtMs = Date.now();
    const response = await fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    const respondedAtMs = Date.now();
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      body = { nonJson: true, preview: text.slice(0, 200) };
    }
    const meta = sourceMeta(body);
    if (prevAt) gaps[`${calls.at(-1)?.service}->${service}`] = requestedAtMs - prevAt;
    prevAt = requestedAtMs;
    const redactedUrl = url.replace(apiKey, "[redacted]");
    calls.push({
      service,
      itstId,
      requestUrlRedacted: redactedUrl,
      requestedAtMs,
      respondedAtMs,
      httpStatus: response.status,
      sourceTimestampMs: meta.sourceTimestampMs,
      responseVersion: meta.responseVersion,
      lagMs: respondedAtMs - requestedAtMs,
      sourceAgeMs:
        meta.sourceTimestampMs !== null
          ? requestedAtMs - meta.sourceTimestampMs
          : null,
      itstIdOnOfficialRequestTable: spec.itstIdListed,
      body,
    });
  }
  return {
    synthetic: false,
    itstId,
    capturedAtMs: Date.now(),
    callGapMs: gaps,
    calls,
  };
}
