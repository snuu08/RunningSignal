import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyCollected } from "../src/real/signals/collect.ts";
import { redactValue } from "../src/real/signals/redact.ts";
import {
  captureTdataIntersection,
  fetchTdataService,
  interpretCurrentState,
  rowsOf,
  TDATA_FILE_ONLY,
  type LiveCallClass,
} from "../src/real/signals/tdata.ts";
import { parseTmap } from "../server/api.ts";
import { UTIC_HUB_LISTED, uticQuery, uticUrl } from "../src/real/signals/utic.ts";

const CLASS_KO: Record<LiveCallClass, string> = {
  "ok-data": "정상 응답과 유효 데이터",
  "ok-empty": "정상 응답이지만 빈 데이터",
  auth: "인증·권한 오류",
  connect: "연결·TLS·타임아웃 오류",
  "spec-unknown": "명세 또는 엔드포인트 미확인",
  "region-unavailable": "해당 지역 미제공",
};

function present(name: string): boolean {
  const v = process.env[name]?.trim();
  return !!v;
}

function secrets(): string[] {
  return [
    process.env.SEOUL_TDATA_API_KEY,
    process.env.TMAP_APP_KEY,
    process.env.KAKAO_REST_API_KEY,
    process.env.UTIC_SERVICE_KEY,
    process.env.DATA_GO_KR_SERVICE_KEY,
  ].filter((s): s is string => !!s && s.length >= 4);
}

function classifyStatus(
  httpStatus: number | null,
  error: string | null,
  hasRows: boolean,
): LiveCallClass {
  if (
    error === "TimeoutError" ||
    error === "AbortError" ||
    error === "TypeError" ||
    error === "no_response" ||
    httpStatus === 0 ||
    httpStatus === null
  )
    return "connect";
  if (httpStatus === 401 || httpStatus === 403) return "auth";
  if (httpStatus === 404) return "spec-unknown";
  if (httpStatus === 502 || httpStatus === 504) return "connect";
  if (httpStatus >= 200 && httpStatus < 300) return hasRows ? "ok-data" : "ok-empty";
  return "spec-unknown";
}

async function probePublicPage(name: string, url: string) {
  const requestedAtMs = Date.now();
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "text/html,application/json,text/csv,*/*" },
    });
    const buf = new Uint8Array(await response.arrayBuffer());
    const collected = classifyCollected(
      response.status,
      response.headers.get("content-type") ?? "",
      buf,
      secrets(),
    );
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const pageFlags = {
      login: /로그인/.test(text),
      download: /다운로드/.test(text),
      csv: /\.csv/i.test(text),
      xls: /\.xlsx?/i.test(text),
      shp: /\.shp/i.test(text),
    };
    return {
      name,
      url,
      class: classifyStatus(
        response.status,
        collected.error ?? null,
        collected.kind === "csv" || collected.kind === "xlsx" || collected.kind === "xls",
      ),
      httpStatus: response.status,
      kind: collected.kind,
      bytes: collected.bytes,
      csvMentionedInPreview: pageFlags.csv,
      pageFlags,
      preview: collected.preview,
      lagMs: Date.now() - requestedAtMs,
      note:
        collected.kind === "html"
          ? "카탈로그 HTML입니다. HTML 403/409만으로 Open API 불가로 보지 않습니다. 파일 본문은 이 응답에 없습니다."
          : collected.kind === "csv" || collected.kind === "xlsx"
            ? "파일 본문이 응답에 포함됐습니다."
            : collected.error ?? null,
    };
  } catch (e) {
    return {
      name,
      url,
      class: "connect" as LiveCallClass,
      httpStatus: null,
      kind: "empty",
      bytes: 0,
      csvMentionedInPreview: false,
      preview: "",
      lagMs: Date.now() - requestedAtMs,
      note: e instanceof Error ? e.name : "fetch_failed",
    };
  }
}

async function probeTmap() {
  const appKey = process.env.TMAP_APP_KEY?.trim();
  if (!appKey)
    return {
      name: "tmap-pedestrian",
      class: "spec-unknown" as LiveCallClass,
      skipped: true,
      reason: "TMAP_APP_KEY 미설정",
    };
  const requestedAtMs = Date.now();
  try {
    const response = await fetch(
      "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1",
      {
        method: "POST",
        headers: {
          appKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          startX: 126.978,
          startY: 37.5665,
          endX: 126.975,
          endY: 37.5658,
          startName: encodeURIComponent("서울시청"),
          endName: encodeURIComponent("덕수궁"),
          reqCoordType: "WGS84GEO",
          resCoordType: "WGS84GEO",
          searchOption: "0",
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      body = { nonJson: true };
    }
    let parsed: {
      distanceM: number;
      points: number;
      instructions: number;
    } | null = null;
    let parseError: string | null = null;
    try {
      const route = parseTmap(body, "0");
      parsed = {
        distanceM: route.distanceM,
        points: route.coordinates.length,
        instructions: route.instructions.length,
      };
    } catch (e) {
      parseError = e instanceof Error ? e.message : "parse_failed";
    }
    let errorShape: { keys: string[]; code: unknown; id: unknown } | null = null;
    if (body && typeof body === "object" && "error" in body) {
      const err = (body as { error: unknown }).error;
      if (err && typeof err === "object") {
        const rec = err as Record<string, unknown>;
        errorShape = {
          keys: Object.keys(rec),
          code: rec.code ?? rec.errorCode ?? rec.status ?? null,
          id: rec.id ?? rec.errorId ?? null,
        };
      }
    }
    return {
      name: "tmap-pedestrian",
      class: classifyStatus(response.status, null, parsed !== null),
      skipped: false,
      httpStatus: response.status,
      lagMs: Date.now() - requestedAtMs,
      parsed,
      parseError,
      bodyKeys:
        body && typeof body === "object" ? Object.keys(body as object).slice(0, 12) : [],
      errorShape,
    };
  } catch (e) {
    return {
      name: "tmap-pedestrian",
      class: "connect" as LiveCallClass,
      skipped: false,
      httpStatus: null,
      lagMs: Date.now() - requestedAtMs,
      parsed: null,
      parseError: e instanceof Error ? e.name : "fetch_failed",
      bodyKeys: [],
    };
  }
}

async function probeKakao() {
  const key = process.env.KAKAO_REST_API_KEY?.trim();
  if (!key)
    return {
      name: "kakao-keyword",
      class: "spec-unknown" as LiveCallClass,
      skipped: true,
      reason: "KAKAO_REST_API_KEY 미설정",
    };
  const requestedAtMs = Date.now();
  try {
    const query = new URLSearchParams({
      query: "덕수궁",
      x: "126.978",
      y: "37.5665",
      radius: "500",
    });
    const response = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?${query}`,
      {
        headers: { Authorization: `KakaoAK ${key}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    const json = (await response.json()) as { documents?: unknown[] };
    const n = Array.isArray(json.documents) ? json.documents.length : 0;
    return {
      name: "kakao-keyword",
      class: classifyStatus(response.status, null, n > 0),
      skipped: false,
      httpStatus: response.status,
      lagMs: Date.now() - requestedAtMs,
      documentCount: n,
    };
  } catch (e) {
    return {
      name: "kakao-keyword",
      class: "connect" as LiveCallClass,
      skipped: false,
      httpStatus: null,
      lagMs: Date.now() - requestedAtMs,
      documentCount: 0,
      error: e instanceof Error ? e.name : "fetch_failed",
    };
  }
}

async function probeMoiListedBase() {
  const key = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  if (!key)
    return {
      name: "mois-rti-listed-base",
      class: "spec-unknown" as LiveCallClass,
      skipped: true,
      reason: "DATA_GO_KR_SERVICE_KEY 미설정. 오퍼레이션 경로를 추측하지 않음.",
    };
  const requestedAtMs = Date.now();
  const listed = "https://apis.data.go.kr/B551982/rti";
  try {
    const url = `${listed}?${new URLSearchParams({ serviceKey: key })}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    return {
      name: "mois-rti-listed-base",
      class: "spec-unknown" as LiveCallClass,
      skipped: false,
      httpStatus: response.status,
      lagMs: Date.now() - requestedAtMs,
      note: "목록에 베이스 URL만 있고 오퍼레이션 경로가 없습니다. 이 호출은 베이스 존재 확인이며 제품 경로가 아닙니다.",
      preview: redactValue(text.slice(0, 180), secrets()),
    };
  } catch (e) {
    return {
      name: "mois-rti-listed-base",
      class: "connect" as LiveCallClass,
      skipped: false,
      httpStatus: null,
      lagMs: Date.now() - requestedAtMs,
      note: e instanceof Error ? e.name : "fetch_failed",
    };
  }
}

async function probeUticSeoul() {
  const key = process.env.UTIC_SERVICE_KEY?.trim();
  if (!key)
    return {
      name: "utic-plan-L01",
      class: "spec-unknown" as LiveCallClass,
      skipped: true,
      reason: "UTIC_SERVICE_KEY 미설정. 서울 예측은 UTIC에 의존하지 않음.",
    };
  const requestedAtMs = Date.now();
  const query = uticQuery("getPlanCROPInfo", {
    serviceKey: key,
    srchCTId: "L01",
    numOfRows: "2",
  });
  const hubs = [
    { name: "https", url: uticUrl("getPlanCROPInfo", query) },
    { name: "http-listed", url: uticUrl("getPlanCROPInfo", query, UTIC_HUB_LISTED) },
  ];
  const attempts: Record<string, unknown>[] = [];
  for (const hub of hubs) {
    try {
      const response = await fetch(hub.url, { signal: AbortSignal.timeout(15000) });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        body = { nonJson: true, preview: text.slice(0, 160) };
      }
      const rows = Array.isArray(body) ? body : [];
      const payload = rows.filter(
        (r) => r && typeof r === "object" && !("resultCode" in (r as object)),
      );
      const head = rows[0] as Record<string, unknown> | undefined;
      const code = head?.resultCode != null ? String(head.resultCode) : "";
      let cls: LiveCallClass = classifyStatus(response.status, null, payload.length > 0);
      if (["20", "22", "30", "31", "32"].includes(code)) cls = "auth";
      else if (response.status >= 200 && response.status < 300 && payload.length === 0)
        cls = "region-unavailable";
      attempts.push({
        hub: hub.name,
        class: cls,
        httpStatus: response.status,
        resultCode: code || null,
        payloadRows: payload.length,
      });
      return {
        name: "utic-plan-L01",
        class: cls,
        skipped: false,
        httpStatus: response.status,
        lagMs: Date.now() - requestedAtMs,
        resultCode: code || null,
        payloadRows: payload.length,
        hub: hub.name,
        attempts,
        note:
          cls === "region-unavailable"
            ? "안내 페이지는 온라인 제어기를 인천·대전·대구로 적습니다. L01 빈 응답을 서울 운영계획으로 쓰지 않습니다."
            : "서울 예측 경로에 사용하지 않습니다.",
      };
    } catch (e) {
      attempts.push({
        hub: hub.name,
        class: "connect",
        error: e instanceof Error ? e.name : "fetch_failed",
      });
    }
  }
  return {
    name: "utic-plan-L01",
    class: "connect" as LiveCallClass,
    skipped: false,
    httpStatus: null,
    lagMs: Date.now() - requestedAtMs,
    attempts,
    error: "both_hubs_failed",
  };
}

export async function runLiveProbe(opts: { skipTdata?: boolean } = {}) {
  const envPresence = {
    VITE_MAPTILER_KEY: present("VITE_MAPTILER_KEY"),
    VITE_SUPABASE_URL: present("VITE_SUPABASE_URL"),
    VITE_SUPABASE_ANON_KEY: present("VITE_SUPABASE_ANON_KEY"),
    KAKAO_REST_API_KEY: present("KAKAO_REST_API_KEY"),
    TMAP_APP_KEY: present("TMAP_APP_KEY"),
    SEOUL_TDATA_API_KEY: present("SEOUL_TDATA_API_KEY"),
    UTIC_SERVICE_KEY: present("UTIC_SERVICE_KEY"),
    DATA_GO_KR_SERVICE_KEY: present("DATA_GO_KR_SERVICE_KEY"),
    SIGNAL_PREDICTION_SCOPES: present("SIGNAL_PREDICTION_SCOPES"),
    SIGNAL_PUBLIC_PREDICTION: process.env.SIGNAL_PUBLIC_PREDICTION === "true",
    SIGNAL_VERIFIED_JSON: present("SIGNAL_VERIFIED_JSON"),
    SIGNAL_VERIFIED_PATH: present("SIGNAL_VERIFIED_PATH"),
  };

  const calls: Record<string, unknown>[] = [];
  const tdataKey = process.env.SEOUL_TDATA_API_KEY?.trim();
  let chosen: {
    itstId: string;
    pedestrianKeys: string[];
    currentPhase: ReturnType<typeof interpretCurrentState> | null;
    currentTiming: ReturnType<typeof interpretCurrentState> | null;
    captureHttp: { service: string; status: number }[];
  } | null = null;

  if (!tdataKey) {
    calls.push({
      name: "tdata-phase-list",
      class: "spec-unknown",
      skipped: true,
      reason: "SEOUL_TDATA_API_KEY 미설정",
    });
  } else if (opts.skipTdata) {
    calls.push({
      name: "tdata-phase-list",
      class: "ok-data",
      skipped: true,
      reason: "이전 실호출 유지. T-DATA 한도 절약.",
    });
  } else {
    const listed = await fetchTdataService("phase", tdataKey, fetch, {
      numOfRows: "20",
    });
    calls.push({
      name: "tdata-phase-list",
      class: listed.class,
      httpStatus: listed.httpStatus,
      lagMs: listed.lagMs,
      rowCount: listed.rowCount,
      itstIds: listed.itstIds,
      pedestrianKeys: listed.pedestrianKeys,
      error: listed.error,
    });
    const rows = rowsOf(listed.body);
    const withPed = rows.find((row) =>
      Object.entries(row).some(
        ([k, v]) => /PdsgStatNm$/.test(k) && v != null && String(v).trim() !== "",
      ),
    );
    const itstId =
      withPed?.itstId != null
        ? String(withPed.itstId)
        : listed.itstIds[0] ?? "";
    if (itstId && /^\d{1,10}$/.test(itstId)) {
      const phase = await fetchTdataService("phase", tdataKey, fetch, {
        itstId,
        numOfRows: "5",
      });
      const timing = await fetchTdataService("timing", tdataKey, fetch, {
        itstId,
        numOfRows: "5",
      });
      calls.push({
        name: "tdata-phase-one",
        itstId,
        class: phase.class,
        httpStatus: phase.httpStatus,
        pedestrianKeys: phase.pedestrianKeys,
        rowCount: phase.rowCount,
      });
      calls.push({
        name: "tdata-timing-one",
        itstId,
        class: timing.class,
        httpStatus: timing.httpStatus,
        remainingKeys: timing.remainingKeys,
        rowCount: timing.rowCount,
      });
      const captured = await captureTdataIntersection(
        itstId,
        tdataKey,
        fetch,
        ["phase", "timing"],
      );
      const phaseBody = captured.calls.find((c) => c.service === "phase")?.body;
      const timingBody = captured.calls.find((c) => c.service === "timing")?.body;
      chosen = {
        itstId,
        pedestrianKeys: phase.pedestrianKeys,
        currentPhase: phaseBody
          ? interpretCurrentState(phaseBody, captured.capturedAtMs, "phase")
          : null,
        currentTiming: timingBody
          ? interpretCurrentState(timingBody, captured.capturedAtMs, "timing")
          : null,
        captureHttp: captured.calls.map((c) => ({
          service: c.service,
          status: c.httpStatus,
        })),
      };
    } else {
      calls.push({
        name: "tdata-phase-one",
        class: listed.class === "ok-data" ? "ok-empty" : listed.class,
        skipped: true,
        reason: "목록에서 교차로 ID를 얻지 못함",
      });
    }
  }

  const [tmap, kakao, utic, moi, file10144, nationalXls, walkNet] =
    await Promise.all([
      probeTmap(),
      probeKakao(),
      probeUticSeoul(),
      probeMoiListedBase(),
      probePublicPage("tdata-10144-catalog", TDATA_FILE_ONLY.crossroad.catalogUrl),
      probePublicPage(
        "national-signal-xls-catalog",
        "https://www.data.go.kr/data/15113147/fileData.do",
      ),
      probePublicPage(
        "seoul-walk-oa-21208-catalog",
        "https://data.seoul.go.kr/dataList/OA-21208/A/1/datasetView.do",
      ),
    ]);

  const mapping = {
    intersectionId: chosen?.itstId ?? null,
    endpoints: "unconfirmed",
    travelDirection: "unconfirmed",
    pedestrianField: chosen?.pedestrianKeys.length
      ? chosen.pedestrianKeys
      : "missing-or-empty",
    sourceTime: chosen?.currentPhase?.sourceTimestampMs ?? null,
    currentState: chosen?.currentPhase?.pedestrian ?? [],
    remainingRaw: chosen?.currentTiming?.remainingPedestrian ?? [],
    remainingAsSeconds: false,
    crossingCorrespondence: "unconfirmed",
    reason:
      "T-DATA 현시/잔여는 교차로 ID·방향 필드명만 제공합니다. 횡단 양끝점 파일(10144 CSV 또는 현장)이 없어 특정 횡단에 대응하지 않습니다.",
  };

  const summary = {
    capturedAtMs: Date.now(),
    envPresence,
    classLabels: CLASS_KO,
    calls: [...calls, tmap, kakao, utic, moi, file10144, nationalXls, walkNet],
    trialIntersection: chosen,
    mapping,
    predictionBlockers: [
      "횡단 양끝점·진행 방향·보행신호 그룹 대응 근거 없음",
      "운영계획 epoch·현재 적용 확인 경로 없음. T-DATA는 현재 현시/잔여이지 TOD가 아님",
      "잔여 단위(센티초 vs 1/10초) 미확인. 초 변환·주기 추정 안 함",
      "currentPlanConfirmedAt를 갱신할 실시간 근거가 없음. 정적 bundle의 확인 시각을 복사하거나 60초를 늘리지 않음",
      "SIGNAL_PUBLIC_PREDICTION / SIGNAL_PREDICTION_SCOPES / 검증 매핑 / LIVE_SIGNAL_UI 가 공개 예측을 막음",
    ],
    predictionReady: false,
  };

  const out = join("data/signals/captures", `live-probe-${summary.capturedAtMs}.json`);
  mkdirSync("data/signals/captures", { recursive: true });
  writeFileSync(out, JSON.stringify(redactValue(summary, secrets()), null, 2));
  const consoleSafe = {
    wrote: out,
    envPresence,
    calls: summary.calls.map((c) => ({
      name: (c as { name?: string }).name,
      class: (c as { class?: string }).class,
      classKo: CLASS_KO[(c as { class?: LiveCallClass }).class as LiveCallClass],
      httpStatus: (c as { httpStatus?: number }).httpStatus ?? null,
      skipped: (c as { skipped?: boolean }).skipped ?? false,
    })),
    trialItstId: chosen?.itstId ?? null,
    pedestrianKeys: chosen?.pedestrianKeys ?? [],
    mappingCorrespondence: mapping.crossingCorrespondence,
    predictionReady: false,
  };
  console.log(JSON.stringify(consoleSafe, null, 2));
  return summary;
}
