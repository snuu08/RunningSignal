import { seoulCredentialsFrom, seoulServiceConfiguration } from "./seoul-keys.ts";
import {
  planReturnedRoutes,
  evaluateSignalCandidates,
  unavailableSignals,
  type RouteSignalProvider,
} from "./signal-service.ts";
import {
  createVerifiedProvider,
  parsePredictionScopes,
} from "../src/real/signals/provider.ts";
import { auditVerifiedBundle } from "../src/real/signals/audit.ts";
import { createSeoulLiveProvider, hasSeoulLiveMappings } from "./seoul-live-provider.ts";
import { resetSeoulFeedClientsForTests, seoulFeedClient } from "./seoul-feed.ts";
import { DATA_GO_SERVICES, dataGoFeedClient, resetDataGoFeedClientsForTests, type DataGoService } from "./data-go-feed.ts";
import { loadVerifiedBundle } from "../src/real/signals/verified-store.ts";
import {
  continuity,
  poisFromInstructions,
  progressOnRoute,
  samplePath,
  scanFacilities,
  validCoord,
  validPace,
  withGeometry,
  type Coord,
  type NearbyPoi,
  type Place,
  type Route,
} from "../src/real/core.ts";
import { parseRoutingPolicy } from "../src/real/routing-policy.ts";
import {
  localLandmarkPlaces,
  mergeAndRankPlaces,
  type SearchPlace,
} from "../src/real/place-ranking.ts";
import {
  LANDMARK_CATEGORIES,
  parseLandmarkKinds,
  type Landmark,
  type LandmarkKind,
} from "../src/real/landmarks.ts";
import {
  TDATA_CALLABLE,
  TDATA_FILE_ONLY,
  interpretCurrentState,
  type TdataCallId,
  type TdataFetchResult,
} from "../src/real/signals/tdata.ts";
import {
  parseUticBody,
  UTIC_OPS,
  uticQuery,
  uticUrl,
  type UticOpId,
} from "../src/real/signals/utic.ts";
import { PROVIDER_CONTRACTS } from "../src/real/signals/contracts.ts";
import { RELEASE_ID } from "./release.ts";
type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
class ApiError extends Error {
  status: number;
  retryAfterMs: number | null;
  providerResponse?: Record<string, unknown>;
  constructor(status: number, message: string, retryAfterMs: number | null = null, providerResponse?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.providerResponse = providerResponse;
  }
}
function seoulDiagnostic(result: TdataFetchResult) {
  return { provider: "tdata", service: result.service, httpStatus: result.httpStatus,
    resultClass: result.class, errorType: result.error, elapsedMs: result.lagMs };
}
/** Instance-local only. Status GET does not probe providers. */
const seoulReach = { okAt: 0, failAt: 0 };
function noteSeoulReachable(ok: boolean) {
  const at = Date.now();
  if (ok) seoulReach.okAt = at;
  else seoulReach.failAt = at;
}
function seoulReachable(): boolean | null {
  if (!seoulReach.okAt && !seoulReach.failAt) return null;
  return seoulReach.okAt > seoulReach.failAt;
}
export function resetApiRuntimeForTests() {
  seoulReach.okAt = 0;
  seoulReach.failAt = 0;
  resetSeoulFeedClientsForTests();
  resetDataGoFeedClientsForTests();
}

export function signalProviderFromEnv(
  env: Env,
  fetcher: Fetch = fetch,
): RouteSignalProvider {
  if (env.SIGNAL_PUBLIC_PREDICTION !== "true") return unavailableSignals;
  const bundle = loadVerifiedBundle(env);
  const scopes = parsePredictionScopes(env.SIGNAL_PREDICTION_SCOPES);
  if (!bundle.crossings.length) return unavailableSignals;
  const credentials = seoulCredentialsFrom(env);
  if (Object.values(credentials).some(Boolean) && bundle.liveMappings?.length)
    return createSeoulLiveProvider(bundle, scopes, credentials, fetcher,
      undefined, seoulFeedClient(credentials, fetcher));
  return createVerifiedProvider(bundle, scopes);
}

function predictionFromEnv(env: Env) {
  const bundle = loadVerifiedBundle(env);
  const scopes = parsePredictionScopes(env.SIGNAL_PREDICTION_SCOPES);
  const publicOn = env.SIGNAL_PUBLIC_PREDICTION === "true";
  const audit = auditVerifiedBundle(bundle, scopes);
  const mappingReady = audit.directionMapped > 0 && audit.widthKnown > 0;
  const planReady = audit.plansVerified > 0 && audit.epochKnown > 0;
  const freshnessReady =
    audit.plansVerified > 0 && !("stale_plan" in audit.excludedReasons);
  const coverageReady =
    audit.crossingsTotal > 0 &&
    audit.surveyCovered === audit.crossingsTotal &&
    !("survey_incomplete" in audit.excludedReasons);
  const fieldValidated = audit.predictionEligible > 0;
  const predictionReady = publicOn && audit.predictionEligible > 0;
  const predictionByRegion = {
    서울: predictionReady && scopes.some((s) => s.source === "tdata" || s.source === "field"),
    인천: false,
    대구: false,
    성남:
      predictionReady &&
      scopes.some(
        (s) =>
          s.source === "field" &&
          s.sourceIntersectionId.startsWith(
            "seongnam-namhansanseong-sujin",
          ),
      ),
  };
  return {
    publicOn,
    liveMappingReady: hasSeoulLiveMappings(bundle, scopes, Date.now()),
    mappingReady,
    planReady,
    freshnessReady,
    coverageReady,
    fieldValidated,
    predictionEligible: audit.predictionEligible,
    predictionReady,
    predictionByRegion,
    scopes,
    excludedReasons: audit.excludedReasons,
    activePilot: "seongnam-namhansanseong-sujin-v1",
    activeDirection: "남한산성입구역→수진역",
  };
}
const WALKING_EMPTY: Record<string, string> = {
  walkable: "조건에 맞는 보행 경로가 없어요.",
  stairs:
    "계단 제외 경로를 확인하지 못했어요. 설정을 변경하거나 다시 시도해 주세요.",
  overpass: "육교·고가 구간이 없는 보행 후보를 확인하지 못했어요.",
  detour: "허용 우회 범위 안의 보행 후보가 없어요.",
};
const json = (value: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });

async function upstream(
  url: string,
  init: RequestInit,
  fetcher: Fetch,
): Promise<any> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
  } catch {
    throw new ApiError(
      502,
      "제공기관 연결에 실패했습니다. 잠시 뒤 다시 시도하세요.",
    );
  }
  if (!response.ok) {
    let code = "";
    try {
      const errBody = JSON.parse(await response.text()) as {
        error?: { code?: unknown };
      };
      if (
        typeof errBody.error?.code === "string" &&
        /^[A-Z][A-Z0-9_]{2,40}$/.test(errBody.error.code)
      )
        code = ` · ${errBody.error.code}`;
    } catch {
      /* keep generic provider error */
    }
    throw new ApiError(
      response.status === 429 ? 429 : 502,
      `제공기관 응답 오류 (${response.status}${code}). 서버의 인증·호출 한도를 확인하세요.`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ApiError(502, "제공기관이 JSON 데이터를 반환하지 않았습니다.");
  }
}

function key(env: Env, name: string): string {
  const k = env[name]?.trim();
  if (!k) throw new ApiError(503, `${name} 설정이 필요합니다.`);
  return k;
}

function place(p: any): p is Place {
  return (
    p &&
    validCoord(p.coord) &&
    typeof p.name === "string" &&
    p.name.length > 0 &&
    p.name.length <= 200
  );
}

/** Only geometry is accepted. Client-supplied signal plans are never trusted. */
function evaluationRoute(value: unknown): Route | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (
    typeof r.id !== "string" || !/^[\w:.-]{1,100}$/.test(r.id) ||
    !Array.isArray(r.coordinates) || r.coordinates.length < 2 ||
    r.coordinates.length > 2500 || !r.coordinates.every(validCoord) ||
    typeof r.distanceM !== "number" || !Number.isFinite(r.distanceM) ||
    r.distanceM <= 0 || r.distanceM > 100_000
  ) return null;
  return withGeometry({
    id: r.id,
    name: typeof r.name === "string" ? r.name.slice(0, 200) : r.id,
    coordinates: r.coordinates as Coord[],
    distanceM: r.distanceM,
    option: typeof r.option === "string" ? r.option : "0",
    instructions: [],
    ...continuity(r.coordinates as Coord[]),
  });
}

export function parseTmap(data: any, option: string): Route {
  if (!Array.isArray(data?.features))
    throw new ApiError(502, "보행 경로 응답 형식이 예상과 다릅니다.");
  const coordinates: Coord[] = [],
    instructions: Route["instructions"] = [];
  for (const f of data.features) {
    if (f.geometry?.type === "LineString") {
      for (const c of f.geometry.coordinates ?? []) {
        if (!validCoord(c))
          throw new ApiError(502, "경로 좌표가 올바르지 않습니다.");
        const last = coordinates.at(-1);
        if (!last || last[0] !== c[0] || last[1] !== c[1]) coordinates.push(c);
      }
    } else if (
      f.geometry?.type === "Point" &&
      validCoord(f.geometry.coordinates) &&
      typeof f.properties?.description === "string"
    ) {
      instructions.push({
        coord: f.geometry.coordinates,
        text: f.properties.description,
      });
    }
  }
  const distanceM = data.features.find((f: any) =>
    Number.isFinite(f.properties?.totalDistance),
  )?.properties.totalDistance;
  if (coordinates.length < 2 || !Number.isFinite(distanceM) || distanceM <= 0)
    throw new ApiError(502, "보행 경로의 거리 또는 좌표가 없습니다.");
  const route: Route = {
    id: `tmap-${option}`,
    name:
      option === "4"
        ? "큰길 우선 후보"
        : option === "30"
          ? "계단 제외 후보"
          : "기본 보행 후보",
    coordinates,
    distanceM,
    option,
    instructions,
    ...continuity(coordinates),
    ...scanFacilities(data.features),
  };
  return withGeometry({
    ...route,
    nearbyPois: poisFromInstructions(route),
  });
}
function kakaoHeaders(env: Env) {
  return { Authorization: `KakaoAK ${key(env, "KAKAO_REST_API_KEY")}` };
}
function mergePois(a: NearbyPoi[], b: NearbyPoi[]): NearbyPoi[] {
  const seen = new Set<string>();
  const out: NearbyPoi[] = [];
  for (const item of [...a, ...b]) {
    const k = item.coord.map((n) => n.toFixed(5)).join(",");
    if (seen.has(k) || seen.has(item.id)) continue;
    seen.add(k);
    seen.add(item.id);
    out.push(item);
  }
  return out.sort((x, y) => x.atM - y.atM).slice(0, 16);
}
export async function kakaoKeywordPois(
  path: Coord[],
  env: Env,
  fetcher: Fetch,
): Promise<NearbyPoi[]> {
  if (!env.KAKAO_REST_API_KEY?.trim() || path.length < 2) return [];
  const samples = samplePath(path, 250).slice(1, -1).slice(0, 5);
  const points = samples.length ? samples : [path[Math.floor(path.length / 2)]];
  const headers = kakaoHeaders(env);
  const found = await Promise.all(
    points.map(async (coord) => {
      const query = new URLSearchParams({
        query: "횡단보도",
        x: String(coord[0]),
        y: String(coord[1]),
        radius: "80",
        size: "5",
        sort: "distance",
      });
      const data = await upstream(
        `https://dapi.kakao.com/v2/local/search/keyword.json?${query}`,
        { headers },
        fetcher,
      );
      if (!Array.isArray(data.documents)) return [];
      return data.documents.flatMap((p: any) => {
        const at: Coord = [Number(p.x), Number(p.y)];
        if (!validCoord(at) || typeof p.place_name !== "string") return [];
        const along = progressOnRoute(path, at);
        if (along.offRouteM > 40) return [];
        const poi: NearbyPoi = {
          id: String(p.id ?? `${at[0]},${at[1]}`),
          name: p.place_name.slice(0, 80),
          coord: at,
          atM: along.traveledM,
          offPathM: along.offRouteM,
          source: "kakao-keyword",
        };
        return [poi];
      });
    }),
  );
  return mergePois([], found.flat());
}
function mergeLandmarks(items: Landmark[]): Landmark[] {
  const seen = new Set<string>();
  const buckets = new Map<LandmarkKind, Landmark[]>();
  for (const item of items) {
    const k = item.coord.map((n) => n.toFixed(5)).join(",");
    if (seen.has(k) || seen.has(item.id)) continue;
    seen.add(k);
    seen.add(item.id);
    const list = buckets.get(item.kind) ?? [];
    list.push(item);
    buckets.set(item.kind, list);
  }
  const out: Landmark[] = [];
  const order = Object.keys(LANDMARK_CATEGORIES) as LandmarkKind[];
  for (let i = 0; out.length < 40; i += 1) {
    let added = false;
    for (const kind of order) {
      const item = buckets.get(kind)?.[i];
      if (!item) continue;
      out.push(item);
      added = true;
      if (out.length >= 40) break;
    }
    if (!added) break;
  }
  return out;
}
export async function kakaoLandmarks(
  coord: Coord,
  radiusM: number,
  kinds: LandmarkKind[],
  env: Env,
  fetcher: Fetch,
): Promise<Landmark[]> {
  if (!env.KAKAO_REST_API_KEY?.trim() || !kinds.length) return [];
  const radius = String(Math.min(20000, Math.max(200, Math.round(radiusM))));
  const headers = kakaoHeaders(env);
  const found = await Promise.all(
    kinds.map(async (kind) => {
      const query = new URLSearchParams({
        category_group_code: LANDMARK_CATEGORIES[kind],
        x: String(coord[0]),
        y: String(coord[1]),
        radius,
        size: "15",
        sort: "distance",
      });
      const data = await upstream(
        `https://dapi.kakao.com/v2/local/search/category.json?${query}`,
        { headers },
        fetcher,
      );
      if (!Array.isArray(data.documents)) return [];
      return data.documents.flatMap((p: any) => {
        const at: Coord = [Number(p.x), Number(p.y)];
        if (!validCoord(at) || typeof p.place_name !== "string") return [];
        const row: Landmark = {
          id: String(p.id ?? `${kind}:${at[0]},${at[1]}`),
          name: p.place_name.slice(0, 40),
          coord: at,
          kind,
        };
        return [row];
      });
    }),
  );
  return mergeLandmarks(found.flat());
}
export async function handleApi(
  request: Request,
  env: Env,
  fetcher: Fetch = fetch,
  signalProvider?: RouteSignalProvider,
): Promise<Response> {
  try {
    const url = new URL(request.url),
      path = url.pathname.replace(/^\/\.netlify\/functions\/api/, "/api");
    const prediction = predictionFromEnv(env);
    const provider =
      prediction.publicOn
        ? (signalProvider ?? signalProviderFromEnv(env, fetcher))
        : unavailableSignals;
    if (request.method === "GET" && path === "/api/status") {
      const seoulServicesConfigured = seoulServiceConfiguration(seoulCredentialsFrom(env));
      const seoulConfigured = Object.values(seoulServicesConfigured).some(Boolean);
      const {
        mappingReady,
        planReady,
        freshnessReady,
        coverageReady,
        fieldValidated,
        predictionEligible,
        predictionReady,
        predictionByRegion,
        excludedReasons,
        activePilot,
        activeDirection,
      } = prediction;
      return json({
        release: { id: RELEASE_ID, seoulServices: Object.keys(TDATA_CALLABLE) },
        seoulServicesConfigured,
        places: !!env.KAKAO_REST_API_KEY,
        routes: !!env.TMAP_APP_KEY,
        seoulSignals: seoulConfigured,
        reverseGeocode: !!env.KAKAO_REST_API_KEY,
        signalPrediction: predictionReady,
        signalDetail: predictionReady
          ? "검증된 횡단·계획 범위에서만 대기를 계산합니다. 그 외 구간은 미확인입니다."
          : prediction.publicOn && seoulConfigured && prediction.liveMappingReady
            ? "검증된 횡단에서 최신 관측을 수신한 뒤 해당 녹색 구간의 대기만 계산합니다. 범위를 벗어나면 미확인입니다."
            : "서울 횡단 방향·잔여값 단위 검증 전입니다. 실시간 대기는 미확인입니다. 키 설정과 예측 가능은 다릅니다.",
        signal: {
          liveFeedConfigured: prediction.publicOn && seoulConfigured && prediction.liveMappingReady,
          apiConfigured:
            seoulConfigured ||
            !!env.UTIC_SERVICE_KEY ||
            !!env.DATA_GO_KR_SERVICE_KEY,
          apiReachable: seoulReachable(),
          configured: {
            seoul: seoulConfigured,
            utic: !!env.UTIC_SERVICE_KEY,
            national: !!env.DATA_GO_KR_SERVICE_KEY,
          },
          reachable: {
            seoul: seoulReachable(),
            utic: null,
            national: null,
          },
          mappingReady,
          planReady,
          freshnessReady,
          coverageReady,
          fieldValidated,
          predictionEligible,
          predictionReady,
          activePilot,
          activeDirection,
          excludedReasons,
          predictionByRegion,
        },
        utic: {
          configured: !!env.UTIC_SERVICE_KEY,
          ready: false,
          detail:
            "안내 페이지의 온라인 제어기는 인천·대전·대구. L01 코드만으로 서울 데이터가 있다고 보지 않음. 계획 조회는 파싱만 하고 대기 예측에 쓰지 않음.",
        },
        national: {
          configured: !!env.DATA_GO_KR_SERVICE_KEY,
          ready: false,
          detail:
            "공공데이터 공식 경로의 신호·교차로 조회를 지원합니다. 원천 지연·단위·보행 방향 검증 전이며 대기 예측에는 사용하지 않습니다.",
        },
      });
    }
    // No arbitrary upstream URLs, key parameters, or server error bodies are exposed.
    if (request.method === "GET" && path === "/api/places") {
      const q = url.searchParams.get("q")?.trim();
      if (!q || q.length > 100)
        throw new ApiError(400, "검색어는 1~100자로 입력하세요.");
      const x = Number(url.searchParams.get("x")),
        y = Number(url.searchParams.get("y"));
      const bias = validCoord([x, y]) ? ([x, y] as Coord) : null;
      const local = localLandmarkPlaces(q, bias);
      if (!env.KAKAO_REST_API_KEY?.trim()) {
        if (local.length) return json({ places: mergeAndRankPlaces(local, { query: q, bias }) });
        throw new ApiError(503, "KAKAO_REST_API_KEY 설정이 필요합니다.");
      }
      const headers = kakaoHeaders(env);
      const keywordQuery = new URLSearchParams({ query: q, size: "15" });
      if (bias) {
        keywordQuery.set("x", String(bias[0]));
        keywordQuery.set("y", String(bias[1]));
      }
      const distanceQuery = new URLSearchParams(keywordQuery);
      distanceQuery.set("sort", "distance");
      const searches = [
        upstream(
          `https://dapi.kakao.com/v2/local/search/keyword.json?${keywordQuery}`,
          { headers },
          fetcher,
        ),
        upstream(
          `https://dapi.kakao.com/v2/local/search/address.json?${new URLSearchParams({ query: q })}`,
          { headers },
          fetcher,
        ),
        ...(bias
          ? [
              upstream(
                `https://dapi.kakao.com/v2/local/search/keyword.json?${distanceQuery}`,
                { headers },
                fetcher,
              ),
            ]
          : []),
      ];
      const [keyword, address, distance] = await Promise.allSettled(searches);
      if (
        keyword.status === "rejected" &&
        address.status === "rejected" &&
        (!bias || distance?.status === "rejected") &&
        !local.length
      )
        throw keyword.reason;
      const keywordDocs =
        keyword.status === "fulfilled" && Array.isArray(keyword.value.documents)
          ? keyword.value.documents
          : [];
      const distanceDocs =
        distance?.status === "fulfilled" && Array.isArray(distance.value.documents)
          ? distance.value.documents
          : [];
      const fromKeyword: SearchPlace[] = keywordDocs.map((p: any, i: number) => ({
        id: String(p.id ?? `keyword:${p.x},${p.y},${i}`),
        name: p.place_name,
        address: p.road_address_name || p.address_name,
        coord: [Number(p.x), Number(p.y)] as Coord,
        category: p.category_group_code || p.category_name,
        distanceM: Number.isFinite(Number(p.distance)) ? Number(p.distance) : undefined,
        originalIndex: i,
        source: "kakao-keyword",
      }));
      const fromDistance: SearchPlace[] = distanceDocs.map((p: any, i: number) => ({
        id: String(p.id ?? `distance:${p.x},${p.y},${i}`),
        name: p.place_name,
        address: p.road_address_name || p.address_name,
        coord: [Number(p.x), Number(p.y)] as Coord,
        category: p.category_group_code || p.category_name,
        distanceM: Number.isFinite(Number(p.distance)) ? Number(p.distance) : undefined,
        originalIndex: i,
        source: "kakao-distance",
      }));
      const fromAddress: SearchPlace[] =
        address.status === "fulfilled" && Array.isArray(address.value.documents)
          ? address.value.documents.map((p: any, i: number) => ({
              id: `addr:${p.x},${p.y},${i}`,
              name: p.road_address?.building_name || p.address_name,
              address:
                p.road_address?.address_name ||
                p.address?.address_name ||
                p.address_name,
              coord: [Number(p.x), Number(p.y)] as Coord,
              category: "address",
              originalIndex: i,
              source: "kakao-address",
            }))
          : [];
      const places = mergeAndRankPlaces(
        [...local, ...fromKeyword, ...fromAddress, ...fromDistance].filter(place),
        { query: q, bias },
      ).slice(0, 15);
      return json({ places });
    }
    if (request.method === "GET" && path === "/api/landmarks") {
      const coord: Coord = [
        Number(url.searchParams.get("x")),
        Number(url.searchParams.get("y")),
      ];
      if (!validCoord(coord))
        throw new ApiError(400, "지도 좌표가 올바르지 않습니다.");
      const radius = Number(url.searchParams.get("radius"));
      if (!Number.isFinite(radius) || radius < 200 || radius > 20000)
        throw new ApiError(400, "검색 반경은 200~20000m입니다.");
      const landmarks = await kakaoLandmarks(
        coord,
        radius,
        parseLandmarkKinds(url.searchParams.get("kinds")),
        env,
        fetcher,
      );
      return json({ landmarks });
    }
    if (request.method === "GET" && path === "/api/places/reverse") {
      const coord: Coord = [
        Number(url.searchParams.get("x")),
        Number(url.searchParams.get("y")),
      ];
      if (!validCoord(coord))
        throw new ApiError(400, "지도 좌표가 올바르지 않습니다.");
      const query = new URLSearchParams({
        x: String(coord[0]),
        y: String(coord[1]),
        input_coord: "WGS84",
      });
      const data = await upstream(
        `https://dapi.kakao.com/v2/local/geo/coord2address.json?${query}`,
        { headers: kakaoHeaders(env) },
        fetcher,
      );
      const doc = Array.isArray(data.documents) ? data.documents[0] : null;
      const road = doc?.road_address,
        lot = doc?.address;
      const name =
        (typeof road?.building_name === "string" && road.building_name) ||
        (typeof road?.address_name === "string" && road.address_name) ||
        (typeof lot?.address_name === "string" && lot.address_name);
      if (!name)
        throw new ApiError(404, "이 좌표의 주소를 찾지 못했습니다.");
      const found = {
        id: `rev:${coord.join(",")}`,
        name: String(name).slice(0, 200),
        address: road?.address_name || lot?.address_name,
        coord,
      };
      if (!place(found))
        throw new ApiError(502, "주소 응답을 확인할 수 없습니다.");
      return json({ place: found });
    }
    if (request.method === "POST" && path === "/api/routes/evaluate") {
      const raw = await request.text();
      if (raw.length > 500_000) throw new ApiError(413, "요청이 너무 큽니다.");
      let body: any;
      try { body = JSON.parse(raw); }
      catch { throw new ApiError(400, "JSON 요청이 필요합니다."); }
      if (!validPace(body?.pace) || !Array.isArray(body?.candidates) ||
        body.candidates.length < 1 || body.candidates.length > 5)
        throw new ApiError(400, "페이스와 경로 후보 1~5개가 필요합니다.");
      const routes: Route[] = [];
      const progress: [string, number][] = [];
      for (const candidate of body.candidates) {
        const route = evaluationRoute(candidate?.route);
        const traveledM = candidate?.traveledM ?? 0;
        if (!route || typeof traveledM !== "number" || !Number.isFinite(traveledM) ||
          traveledM < 0 || traveledM > route.distanceM ||
          routes.some((r) => r.id === route.id))
          throw new ApiError(400, "경로 좌표·거리·진행 위치를 확인하세요.");
        routes.push(route);
        progress.push([route.id, traveledM]);
      }
      const departureMs = Date.now();
      const assessment = await evaluateSignalCandidates(
        routes, body.pace, departureMs, provider,
        parseRoutingPolicy(body.policy), Object.fromEntries(progress),
      );
      return json(assessment);
    }
    if (request.method === "POST" && path === "/api/routes") {
      const raw = await request.text();
      if (raw.length > 12000) throw new ApiError(413, "요청이 너무 큽니다.");
      let body: any;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new ApiError(400, "JSON 요청이 필요합니다.");
      }
      if (
        !place(body.origin) ||
        !place(body.destination) ||
        !validPace(body.pace)
      )
        throw new ApiError(400, "출발지·목적지·페이스를 확인하세요.");
      if (
        !Array.isArray(body.waypoints) ||
        body.waypoints.length > 5 ||
        !body.waypoints.every(place)
      )
        throw new ApiError(400, "경유지는 최대 5곳입니다.");
      const policy = parseRoutingPolicy(body.policy);
      const appKey = key(env, "TMAP_APP_KEY");
      const results = await Promise.allSettled(
        ["4", "30", "0"].map(async (option) => {
          const data = await upstream(
            "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1",
            {
              method: "POST",
              headers: {
                appKey,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                startX: body.origin.coord[0],
                startY: body.origin.coord[1],
                endX: body.destination.coord[0],
                endY: body.destination.coord[1],
                startName: encodeURIComponent(body.origin.name),
                endName: encodeURIComponent(body.destination.name),
                reqCoordType: "WGS84GEO",
                resCoordType: "WGS84GEO",
                searchOption: option,
                ...(body.waypoints.length
                  ? {
                      passList: body.waypoints
                        .map((p: Place) => p.coord.join(","))
                        .join("_"),
                    }
                  : {}),
              }),
            },
            fetcher,
          );
          return parseTmap(data, option);
        }),
      );
      const routes = results.flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
      if (!routes.length) throw (results[0] as PromiseRejectedResult).reason;
      const tmapOk = routes.length;
      const withPois = await Promise.all(
        routes.map(async (route) => {
          try {
            const extra = await kakaoKeywordPois(
              route.coordinates,
              env,
              fetcher,
            );
            return {
              ...route,
              nearbyPois: mergePois(route.nearbyPois ?? [], extra),
            };
          } catch {
            return route;
          }
        }),
      );
      const departureMs = Date.now();
      const planned = await planReturnedRoutes(
        withPois,
        body.pace,
        departureMs,
        policy,
        provider,
      );
      if (!planned.assessment || !planned.routes.length)
        throw new ApiError(
          404,
          WALKING_EMPTY[planned.emptyReason] ?? WALKING_EMPTY.walkable,
        );
      return json({
        routes: planned.routes,
        partial: tmapOk < 3,
        policyApplied: policy,
        avoidanceCheck: planned.avoidance,
        ...planned.assessment,
      });
    }
    if (request.method === "GET" && path === "/api/signals/seoul") {
      const itstId = url.searchParams.get("itstId");
      if (!itstId || !/^\d{1,10}$/.test(itstId))
        throw new ApiError(400, "유효한 교차로 ID가 필요합니다.");
      const service = url.searchParams.get("service") ?? "phase";
      if (service === "crossroad")
        throw new ApiError(
          503,
          `교차로 MAP은 Open API가 아니라 파일입니다. ${TDATA_FILE_ONLY.crossroad.catalogUrl}`,
        );
      if (!Object.hasOwn(TDATA_CALLABLE, service))
        throw new ApiError(400, "지원하지 않는 신호 서비스입니다.");
      const credentials = seoulCredentialsFrom(env);
      if (!Object.values(credentials).some(Boolean)) key(env, "SEOUL_TDATA_API_KEY");
      try {
        const feed = seoulFeedClient(credentials, fetcher);
        const observation = service === "current" ? await feed.snapshot(itstId) : null;
        const result = observation?.result ?? await feed.read(service as TdataCallId, itstId);
        if (result.class === "auth")
          throw new ApiError(503, result.error === "missing_api_key" ? "요청한 서울 신호 서비스의 서버 인증키가 설정되지 않았습니다." :
            "서울 신호 인증에 실패했습니다. 서버 인증키와 해당 API 활용 승인을 확인하세요.", null, seoulDiagnostic(result));
        if (result.class === "rate-limited")
          throw new ApiError(429, "서울 신호 API 호출 한도를 초과했습니다. 잠시 뒤 다시 시도하세요.", feed.retryAfterMs(result.service), seoulDiagnostic(result));
        if (result.class === "connect")
          throw new ApiError(502, result.error === "TimeoutError" ? "서울 신호 제공기관 응답 대기시간을 초과했습니다." :
            "제공기관 연결에 실패했습니다. 잠시 뒤 다시 시도하세요.", null, seoulDiagnostic(result));
        if (result.httpStatus === 404)
          throw new ApiError(503, "서울 실시간 API가 제공기관에서 404를 반환했습니다. T-DATA 실시간 서비스의 활용 승인·서비스 상태를 확인하세요.",
            observation?.retryAfterMs ?? null, seoulDiagnostic(result));
        if (result.class !== "ok-data" && result.class !== "ok-empty")
          throw new ApiError(502, "서울 신호 응답 형식을 확인하지 못했습니다. API 서비스 경로와 활용 승인을 확인하세요.", null, seoulDiagnostic(result));
        const data = observation?.data ?? result.body;
        noteSeoulReachable(true);
        const fetchedAt = Date.now();
        const kind = service === "current" ? "current" :
          service === "timing" || service === "timing-current" ? "timing" : "phase";
        return json({
          source: "서울특별시 T-DATA",
          service,
          resultClass: result.class,
          fetchedAt,
          capability: "current-state-only",
          predictionReady: false,
          ...(observation ? { observation: {
            source: observation.source, synchronized: observation.synchronized,
            fresh: observation.fresh, issues: observation.issues,
            sourceAgeMs: observation.sourceAgeMs,
          } } : {}),
          current: interpretCurrentState(data, fetchedAt, kind, itstId),
          data,
        });
      } catch (error) {
        noteSeoulReachable(false);
        throw error;
      }
    }
    if (request.method === "GET" && path === "/api/signals/utic") {
      const op = url.searchParams.get("op") as UticOpId | null;
      const queryOps = (Object.keys(UTIC_OPS) as UticOpId[]).filter(
        (id) => UTIC_OPS[id].kind === "query",
      );
      if (!op)
        throw new ApiError(
          400,
          `op 가 필요합니다. ${queryOps.join(", ")}`,
        );
      if (!(op in UTIC_OPS))
        throw new ApiError(400, "지원하지 않는 UTIC 오퍼레이션입니다.");
      if (UTIC_OPS[op].kind === "file")
        throw new ApiError(
          503,
          "교차로 기반정보는 파일 다운로드입니다. JSON 프록시로 받지 않습니다.",
        );
      const contractId = op === "getSigMapCRInfo" ? "utic-sigmap" : "utic-plan";
      if (!PROVIDER_CONTRACTS.find((c) => c.id === contractId)?.mayCall)
        throw new ApiError(503, "이 UTIC 오퍼레이션은 호출 계약이 없습니다.");
      const srchCTId = url.searchParams.get("srchCTId")?.trim() ?? "";
      const srchCRNm = url.searchParams.get("srchCRNm")?.trim() ?? "";
      let query: URLSearchParams;
      try {
        query = uticQuery(op, {
          serviceKey: key(env, "UTIC_SERVICE_KEY"),
          srchCTId,
          srchCRNm: srchCRNm || undefined,
        });
      } catch {
        throw new ApiError(400, "지역코드 srchCTId 가 코드표에 없습니다.");
      }
      const data = await upstream(uticUrl(op, query), {}, fetcher);
      const kind =
        op === "getPlanCROPInfo"
          ? "crop"
          : op === "getPlanCRWDInfo"
            ? "weekday"
            : op === "getPlanCRHDInfo"
              ? "holiday"
              : op === "getPlanCRRSInfo"
                ? "reserve"
                : "sigmap";
      return json({
        source: "UTIC tsihub",
        op,
        fetchedAt: Date.now(),
        capability: "documented-plan-only",
        predictionReady: false,
        engineReady: false,
        parsed: parseUticBody(kind, data),
        data,
      });
    }
    if (request.method === "GET" && path === "/api/signals/national") {
      const service = url.searchParams.get("service") ?? "current";
      if (!Object.hasOwn(DATA_GO_SERVICES, service)) throw new ApiError(400, "지원하지 않는 공공데이터 서비스입니다.");
      const police = service === "police-crossroad";
      const region = url.searchParams.get(police ? "srchCTid" : "stdgCd") ?? (police ? "L01" : "1100000000");
      const pageNo = url.searchParams.get("pageNo") ?? "1";
      if (!(police ? /^L\d{2}$/ : /^\d{10}$/).test(region) || !/^[1-9]\d{0,2}$/.test(pageNo))
        throw new ApiError(400, "유효한 지역 코드와 페이지 번호가 필요합니다.");
      const result = await dataGoFeedClient(key(env, "DATA_GO_KR_SERVICE_KEY"), fetcher)
        .read(service as DataGoService, region, pageNo);
      if (result.class === "rate-limited")
        throw new ApiError(429, "공공데이터 API 호출 한도를 초과했습니다.", result.retryAfterMs);
      if (result.class === "auth") throw new ApiError(503, "공공데이터 인증·활용 승인을 확인하세요.");
      if (result.class !== "ok-data" && result.class !== "ok-empty")
        return json({ error: `공공데이터 제공기관 응답 오류 (HTTP ${result.httpStatus ?? "연결 실패"}${result.resultCode ? ` · 코드 ${result.resultCode}` : ""}${result.responseFormat === "xml" ? " · XML" : ""}).`,
          providerResponse: { httpStatus: result.httpStatus, format: result.responseFormat ?? "unknown",
            contentType: result.responseType ?? "unknown", fieldNames: result.responseKeys ?? [],
            rootType: result.rootType ?? "unknown", ...(result.arrayLength !== undefined ? { arrayLength: result.arrayLength } : {}),
            elapsedMs: result.elapsedMs ?? null, transportError: result.transportError ?? null } }, 502);
      return json({ source: police ? "경찰청 공공데이터포털" : "행정안전부 한국지역정보개발원",
        service, region, pageNo: Number(pageNo), ...result,
        predictionReady: false, capability: "diagnostic-snapshot",
        detail: "제공기관 원천 시각·잔여 단위·보행 방향 검증 전입니다. 이 응답은 대기 예측이 아닙니다." });
    }
    return json({ error: "지원하지 않는 API 요청입니다." }, 404);
  } catch (error) {
    return json(
      {
        error:
          error instanceof ApiError
            ? error.message
            : "요청 처리에 실패했습니다.",
        ...(error instanceof ApiError && error.retryAfterMs !== null ? { retryAfterMs: error.retryAfterMs } : {}),
        ...(error instanceof ApiError && error.providerResponse ? { providerResponse: error.providerResponse } : {}),
      },
      error instanceof ApiError ? error.status : 500,
      error instanceof ApiError && error.retryAfterMs !== null
        ? { "Retry-After": String(Math.ceil(error.retryAfterMs / 1000)) } : {},
    );
  }
}
