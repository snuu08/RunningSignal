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
  const row = Array.isArray(body)
    ? body[0]
    : body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : null;
  if (!row || typeof row !== "object")
    return { sourceTimestampMs: null, responseVersion: null };
  const rec = row as Record<string, unknown>;
  const ts = rec.trsmUtcTime ?? rec.regDt;
  const n = typeof ts === "number" ? ts : Number(ts);
  return {
    sourceTimestampMs: Number.isFinite(n) ? n : null,
    responseVersion: rec.dataId != null ? String(rec.dataId) : rec.regDt != null ? String(rec.regDt) : null,
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
