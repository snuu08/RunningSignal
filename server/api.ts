import {
  evaluateSignalCandidates,
  unavailableSignals,
  type RouteSignalProvider,
} from "./signal-service.ts";
import {
  continuity,
  validCoord,
  validPace,
  type Coord,
  type Place,
  type Route,
} from "../src/real/core.ts";
type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
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
  if (!response.ok)
    throw new ApiError(
      response.status === 429 ? 429 : 502,
      `제공기관 응답 오류 (${response.status}). 서버의 키 승인·호출 한도를 확인하세요.`,
    );
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
  return {
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
  };
}
export async function handleApi(
  request: Request,
  env: Env,
  fetcher: Fetch = fetch,
  signalProvider: RouteSignalProvider = unavailableSignals,
): Promise<Response> {
  try {
    const url = new URL(request.url),
      path = url.pathname.replace(/^\/\.netlify\/functions\/api/, "/api");
    if (request.method === "GET" && path === "/api/status")
      return json({
        places: !!env.KAKAO_REST_API_KEY,
        routes: !!env.TMAP_APP_KEY,
        seoulSignals: !!env.SEOUL_TDATA_API_KEY,
        signalPrediction: false,
        signalDetail:
          "실제 횡단 방향 매핑·운영계획 검증 전입니다. 신호 대기는 예측하지 않습니다.",
        utic: {
          configured: !!env.UTIC_SERVICE_KEY,
          ready: false,
          detail: "승인된 서비스 명세와 응답 샘플 연결 필요",
        },
        national: {
          configured: !!env.DATA_GO_KR_SERVICE_KEY,
          ready: false,
          detail: "개별 데이터셋 엔드포인트·응답 검증 필요",
        },
      });
    // No arbitrary upstream URLs, key parameters, or server error bodies are exposed.
    if (request.method === "GET" && path === "/api/places") {
      const q = url.searchParams.get("q")?.trim();
      if (!q || q.length > 100)
        throw new ApiError(400, "검색어는 1~100자로 입력하세요.");
      const query = new URLSearchParams({ query: q, size: "10" });
      const data = await upstream(
        `https://dapi.kakao.com/v2/local/search/keyword.json?${query}`,
        {
          headers: {
            Authorization: `KakaoAK ${key(env, "KAKAO_REST_API_KEY")}`,
          },
        },
        fetcher,
      );
      if (!Array.isArray(data.documents))
        throw new ApiError(502, "장소 검색 응답을 확인할 수 없습니다.");
      return json({
        places: data.documents
          .map((p: any) => ({
            id: p.id,
            name: p.place_name,
            address: p.road_address_name || p.address_name,
            coord: [Number(p.x), Number(p.y)],
          }))
          .filter((p: Place) => place(p)),
      });
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
      const departureMs = Date.now();
      const assessment = await evaluateSignalCandidates(
        routes,
        body.pace,
        departureMs,
        signalProvider,
      );
      return json({
        routes,
        partial: routes.length < 3,
        signalCoverage: "unknown",
        departureMs,
        ...assessment,
      });
    }
    if (request.method === "GET" && path === "/api/signals/seoul") {
      const itstId = url.searchParams.get("itstId");
      if (!itstId || !/^\d{1,10}$/.test(itstId))
        throw new ApiError(400, "유효한 교차로 ID가 필요합니다.");
      const service = url.searchParams.get("service") ?? "phase";
      const services: Record<string, string> = {
        phase: "v2xSignalPhaseInformation",
        timing: "v2xSignalPhaseTimingInformation",
        crossroad: "v2xCrossroadMapInformation",
        connection: "v2xSignalConnectionMapInformation",
        lane: "v2xLaneMapInformation",
      };
      if (!services[service])
        throw new ApiError(400, "지원하지 않는 신호 서비스입니다.");
      const query = new URLSearchParams({
        apiKey: key(env, "SEOUL_TDATA_API_KEY"),
        type: "json",
        pageNo: "1",
        numOfRows: "10",
        itstId,
      });
      const data = await upstream(
        `https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/${services[service]}/1.0?${query}`,
        {},
        fetcher,
      );
      return json({
        source: "서울특별시 T-DATA",
        service,
        fetchedAt: Date.now(),
        capability: "current-state-only",
        predictionReady: false,
        data,
      });
    }
    return json({ error: "지원하지 않는 API 요청입니다." }, 404);
  } catch (error) {
    return json(
      {
        error:
          error instanceof ApiError
            ? error.message
            : "요청 처리에 실패했습니다.",
      },
      error instanceof ApiError ? error.status : 500,
    );
  }
}
