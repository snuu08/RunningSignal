import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROVIDER_CONTRACTS, unverifiedContracts } from "../src/real/signals/contracts.ts";
import { etlCrossings, etlGeoJson, etlObservations, etlPlans, rejectSpreadsheetFilename } from "../src/real/signals/etl.ts";
import { redactValue } from "../src/real/signals/redact.ts";
import { captureTdataIntersection, contrastInCodeUrl, TDATA_CALLABLE, TDATA_FILE_ONLY, tdataUrl } from "../src/real/signals/tdata.ts";
import { parseUticBody, UTIC_HUB_LISTED, UTIC_OPS, uticQuery, uticUrl, type UticOpId } from "../src/real/signals/utic.ts";
import type { MappingFile } from "../src/real/signals/etl.ts";

function loadEnvLocal() {
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function help() {
  return `FLOW RUN signal collection (prediction stays off)

Place files:
  data/signals/inbox/     원본 CSV·GeoJSON (직접 넣기)
  data/signals/forms/     작성용 양식
  data/signals/samples/   합성 예시 (synthetic=true)
  data/signals/raw|normalized|verified/
  data/signals/captures/  T-DATA 캡처 (gitignore, 키 제거됨)

Commands:
  npm run signals -- help
  npm run signals -- contracts
  npm run signals -- capture --itstId 1537
  npm run signals -- utic-url --op getPlanCROPInfo --srchCTId L01
  npm run signals -- parse-utic --kind crop --input data/signals/inbox/crop.json
  npm run signals -- etl --kind crossings --input data/signals/inbox/crossings.csv --mapping data/signals/mappings/crossing-csv.json
  npm run signals -- etl --kind plans --input data/signals/inbox/plans.csv --mapping data/signals/mappings/plan-csv.json
  npm run signals -- etl --kind observations --input data/signals/inbox/field-observation.csv
  npm run signals -- etl --kind geojson --input data/signals/inbox/crossings.geojson --mapping data/signals/mappings/seoul-spatial.json
`;
}

function arg(argv: string[], name: string, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] ?? fallback : fallback;
}

export async function main(argv = process.argv.slice(2)) {
  loadEnvLocal();
  const cmd = argv[0] ?? "help";
  if (cmd === "help" || cmd === "-h") {
    console.log(help());
    return;
  }
  if (cmd === "contracts") {
    const rows = PROVIDER_CONTRACTS.map((c) => ({
      id: c.id,
      status: c.status,
      mayCall: c.mayCall,
      catalogUrl: c.catalogUrl,
      listedEndpoint: c.listedEndpoint,
    }));
    console.log(JSON.stringify({ unverified: unverifiedContracts().map((c) => c.id), all: rows }, null, 2));
    return;
  }
  if (cmd === "capture") {
    const itstId = arg(argv, "--itstId");
    const key = process.env.SEOUL_TDATA_API_KEY?.trim();
    if (!itstId) throw new Error("--itstId 가 필요합니다.");
    if (!key) throw new Error("SEOUL_TDATA_API_KEY 가 없습니다. 호출하지 않습니다.");
    const session = await captureTdataIntersection(itstId, key, fetch);
    const redacted = redactValue(session, [key]);
    const out = arg(
      argv,
      "--out",
      join("data/signals/captures", `tdata-${itstId}-${session.capturedAtMs}.json`),
    );
    writeJson(out, redacted);
    const contrast = Object.keys(TDATA_CALLABLE).map((s) =>
      contrastInCodeUrl(
        s,
        tdataUrl(s as keyof typeof TDATA_CALLABLE, new URLSearchParams({ apiKey: "x" })),
      ),
    );
    console.log(
      JSON.stringify(
        {
          wrote: out,
          itstId,
          http: session.calls.map((c) => ({ service: c.service, status: c.httpStatus, lagMs: c.lagMs })),
          contrast,
          fileOnly: TDATA_FILE_ONLY,
          predictionReady: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (cmd === "utic-url") {
    const op = arg(argv, "--op") as UticOpId;
    const srchCTId = arg(argv, "--srchCTId");
    if (!op || !(op in UTIC_OPS)) throw new Error("--op 는 문서된 UTIC 오퍼레이션이어야 합니다.");
    const q = uticQuery(op, {
      serviceKey: process.env.UTIC_SERVICE_KEY?.trim() || "KEY",
      srchCTId,
      srchCRNm: arg(argv, "--srchCRNm") || undefined,
    });
    const url = uticUrl(op, q);
    const keys = [process.env.UTIC_SERVICE_KEY?.trim() ?? ""].filter(Boolean);
    console.log(
      JSON.stringify(
        {
          op,
          kind: UTIC_OPS[op].kind,
          listedHttp: redactValue(uticUrl(op, q, UTIC_HUB_LISTED), keys),
          usedHttps: redactValue(url, keys),
          predictionReady: false,
          engineReady: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (cmd === "parse-utic") {
    const kind = arg(argv, "--kind") as "crop" | "weekday" | "holiday" | "reserve" | "sigmap";
    const input = arg(argv, "--input");
    if (!kind || !input) throw new Error("--kind 와 --input 이 필요합니다.");
    const body = JSON.parse(readFileSync(input, "utf8"));
    const parsed = parseUticBody(kind, body);
    const out = arg(argv, "--out", join("data/signals/normalized", `utic-${kind}.json`));
    writeJson(out, { predictionReady: false, engineReady: false, records: parsed });
    console.log(JSON.stringify({ wrote: out, kept: parsed.length }, null, 2));
    return;
  }
  if (cmd === "etl") {
    const kind = arg(argv, "--kind");
    const input = arg(argv, "--input");
    const mappingPath = arg(argv, "--mapping");
    if (!kind || !input) throw new Error("--kind 와 --input 이 필요합니다.");
    const sheet = rejectSpreadsheetFilename(input);
    if (sheet) throw new Error(`${sheet}: CSV 또는 GeoJSON으로 저장한 뒤 실행하세요.`);
    const text = readFileSync(input, "utf8");
    const mapping: MappingFile = mappingPath
      ? JSON.parse(readFileSync(mappingPath, "utf8"))
      : { source: "field", crs: "EPSG:4326", geometryType: "crossing-endpoints", columns: {} };
    const report =
      kind === "crossings"
        ? etlCrossings(text, mapping)
        : kind === "plans"
          ? etlPlans(text, mapping)
          : kind === "observations"
            ? etlObservations(text)
            : kind === "geojson"
              ? etlGeoJson(JSON.parse(text), mapping)
              : null;
    if (!report) throw new Error("unknown --kind");
    const outDir = arg(argv, "--out", "data/signals/normalized");
    writeJson(join(outDir, `${kind}-records.json`), {
      synthetic: mapping.synthetic === true,
      stage: "normalized",
      records: report.records,
    });
    writeJson(join(outDir, `${kind}-exclusions.json`), report.exclusions);
    console.log(
      JSON.stringify(
        { kept: report.kept, excluded: report.exclusions.length, outDir },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

await main().catch((err) => {
  console.error(err instanceof Error ? err.message : "failed");
  process.exitCode = 1;
});
