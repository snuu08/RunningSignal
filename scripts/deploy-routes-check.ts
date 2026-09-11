import { loadEnv } from "vite";
import { handleApi } from "../server/api.ts";

const viteEnv = { ...process.env, ...loadEnv("development", process.cwd(), "") };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function report(label: string, status: number, body: Record<string, unknown>) {
  const routes = Array.isArray(body.routes) ? body.routes : [];
  console.log(
    JSON.stringify({
      label,
      httpStatus: status,
      error: typeof body.error === "string" ? body.error : null,
      routeCount: routes.length,
      routeIds: routes.map((r: { id?: string }) => r.id ?? null),
      recommendedId: body.recommendedId ?? null,
      predictionReady: body.predictionReady ?? null,
      signalCoverage: body.signalCoverage ?? null,
      avoidance: body.avoidanceCheck ?? null,
      firstDistanceM: routes[0]?.distanceM ?? null,
      firstName: routes[0]?.name ?? null,
    }),
  );
}

async function routes(body: unknown) {
  const response = await handleApi(
    new Request("http://localhost/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    viteEnv,
  );
  return { status: response.status, body: asRecord(await response.json()) };
}

const origin = {
  id: "o",
  name: "서울시청",
  coord: [126.978, 37.5665] as [number, number],
};
const destination = {
  id: "d",
  name: "덕수궁",
  coord: [126.975, 37.5658] as [number, number],
};

const stairsPolicy = {
  detourRatio: 0.1,
  detourMaxM: 300,
  avoidStairs: true,
  avoidOverpass: false,
  avoidAlley: false,
};

const oneWay = await routes({
  origin,
  destination,
  waypoints: [],
  pace: 360,
  policy: stairsPolicy,
});
report("stairs-avoid-one-way", oneWay.status, oneWay.body);

const loop = await routes({
  origin,
  destination: origin,
  waypoints: [destination],
  pace: 360,
  policy: stairsPolicy,
});
report("loop-return-to-origin", loop.status, loop.body);

const status = await handleApi(new Request("http://localhost/api/status"), viteEnv);
const statusBody = asRecord(await status.json());
const signal = asRecord(statusBody.signal);
console.log(
  JSON.stringify({
    label: "status",
    httpStatus: status.status,
    places: statusBody.places,
    routes: statusBody.routes,
    signalPrediction: statusBody.signalPrediction,
    predictionReady: signal.predictionReady ?? null,
  }),
);
