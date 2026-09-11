import { readFileSync, existsSync } from "node:fs";
import { loadEnv } from "vite";
import { handleApi } from "../server/api.ts";

const NAME = "TMAP_APP_KEY";
const URL = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1";
const OFFICIAL_BODY = {
  startX: 126.92365493654832,
  startY: 37.556770374096615,
  endX: 126.92432158129688,
  endY: 37.55279861528311,
  startName: "%EC%B6%9C%EB%B0%9C",
  endName: "%EB%8F%84%EC%B0%A9",
};

function describeValue(raw: string | undefined) {
  if (raw == null)
    return { present: false };
  const trimmed = raw.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  return {
    present: raw.length > 0,
    length: raw.length,
    trimmedLength: trimmed.length,
    unquotedLength: unquoted.length,
    leadingWhitespace: raw !== raw.trimStart(),
    trailingWhitespace: raw !== raw.trimEnd(),
    wrappingAsciiQuotes:
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")),
    wrappingSmartQuotes: /^[\u201C\u201D\u2018\u2019]/.test(trimmed),
    hasWhitespaceInside: /\s/.test(unquoted),
    hasBomChar: raw.charCodeAt(0) === 0xfeff,
    nonAscii: /[^\x20-\x7E]/.test(unquoted),
    looksLikeUrl: /^https?:\/\//i.test(unquoted) || /[?&]appKey=/i.test(unquoted),
    charset: /^[A-Za-z0-9]+$/.test(unquoted)
      ? "alnum"
      : /^[A-Za-z0-9._-]+$/.test(unquoted)
        ? "alnum-dot-dash"
        : "mixed",
  };
}

function parseEnvFile(path: string) {
  const buf = readFileSync(path);
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const text = buf.toString("utf8").replace(/^\uFEFF/, "");
  const hits: { line: number; rawLength: number; looksLikeAssignment: boolean }[] = [];
  const map: Record<string, string> = {};
  const order: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq < 1) return;
    const k = line.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) return;
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (k === NAME)
      hits.push({
        line: i + 1,
        rawLength: line.slice(eq + 1).length,
        looksLikeAssignment: true,
      });
    map[k] = v;
    order.push(k);
  });
  return { bom, hits, map, order };
}

async function officialMin(appKey: string) {
  const requestedAt = Date.now();
  const response = await fetch(URL, {
    method: "POST",
    headers: {
      appKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(OFFICIAL_BODY),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = { nonJson: true };
  }
  const err =
    body && typeof body === "object" && "error" in body
      ? (body as { error: Record<string, unknown> }).error
      : null;
  const features = Array.isArray((body as { features?: unknown }).features)
    ? (body as { features: unknown[] }).features.length
    : 0;
  return {
    httpStatus: response.status,
    lagMs: Date.now() - requestedAt,
    errorCode: err?.code ?? null,
    errorId: err?.id ?? null,
    errorCategory: err?.category ?? null,
    featureCount: features,
    bodyKeys:
      body && typeof body === "object" ? Object.keys(body as object).slice(0, 8) : [],
  };
}

const files = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
].filter((p) => existsSync(p));

const parsed = Object.fromEntries(
  files.map((p) => [p, parseEnvFile(p)]),
);
const local = parsed[".env.local"];
const viteEnv = { ...process.env, ...loadEnv("development", process.cwd(), "") };
const fromFile = local?.map[NAME];
const fromVite = viteEnv[NAME];
const fromProcess = process.env[NAME];

const others = ["KAKAO_REST_API_KEY", "SEOUL_TDATA_API_KEY", "UTIC_SERVICE_KEY", "DATA_GO_KR_SERVICE_KEY", "VITE_MAPTILER_KEY"];
const sameAsOther = others.filter(
  (n) => fromVite && viteEnv[n] && viteEnv[n] === fromVite,
);

const report: Record<string, unknown> = {
  envFilesPresent: files,
  fileBom: local ? { ".env.local": parseEnvFile(".env.local").bom } : {},
  tmapAssignmentLines: local?.hits ?? [],
  laterKeysAfterTmap: local
    ? local.order.slice(local.order.lastIndexOf(NAME) + 1)
    : [],
  processEnv: describeValue(fromProcess),
  envLocalParsed: describeValue(fromFile),
  viteLoadEnv: describeValue(fromVite),
  processEqualsFile: !!(fromProcess && fromFile && fromProcess === fromFile),
  viteEqualsFile: !!(fromVite && fromFile && fromVite.trim() === fromFile.trim()),
  sameValueAsOtherNamedKeys: sameAsOther,
  request: {
    method: "POST",
    url: URL,
    headerName: "appKey",
    headerMatchesOfficial: true,
    requiredBody: ["startX", "startY", "endX", "endY", "startName", "endName"],
  },
};

if (!fromVite?.trim()) {
  console.log(JSON.stringify({ ...report, minCall: "skipped-no-key" }, null, 2));
  process.exit(1);
}

const min = await officialMin(fromVite.trim());
let appHandleApi: Record<string, unknown> | null = null;
if (min.httpStatus >= 200 && min.httpStatus < 300 && min.featureCount > 0) {
  const app = await handleApi(
    new Request("http://localhost/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin: { id: "o", name: "출발", coord: [126.978, 37.5665] },
        destination: { id: "d", name: "도착", coord: [126.975, 37.5658] },
        waypoints: [],
        pace: 360,
      }),
    }),
    viteEnv,
  );
  const appBody = (await app.json()) as Record<string, unknown>;
  appHandleApi = {
    httpStatus: app.status,
    error: typeof appBody.error === "string" ? appBody.error : null,
    routeCount: Array.isArray(appBody.routes) ? appBody.routes.length : 0,
    predictionReady: appBody.predictionReady ?? null,
  };
}

console.log(
  JSON.stringify(
    {
      ...report,
      officialMinCall: min,
      appHandleApi: appHandleApi ?? "skipped-until-official-min-succeeds",
    },
    null,
    2,
  ),
);
