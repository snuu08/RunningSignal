// Run against an existing deployment. No credentials are read or printed.
import { writeFile } from "node:fs/promises";

const base = process.argv[2];
const itstId = process.argv[3] ?? "20386";
if (!base || !/^https?:\/\//.test(base) || !/^\d{1,10}$/.test(itstId)) {
  console.error("Usage: npm run verify:release -- https://your-site.example [intersectionId]");
  process.exit(2);
}
const expected = "seoul-live-wait-20261017-r2";
const checks = [];
async function get(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(25_000) });
  return { status: response.status, body: await response.json() };
}
try {
  const status = await get("/api/status");
  checks.push({ name: "release", ok: status.body.release?.id === expected, observed: status.body.release?.id ?? null, expected });
  checks.push({ name: "current-service", ok: status.body.release?.seoulServices?.includes("current") === true });
  const signal = await get(`/api/signals/seoul?service=current&itstId=${itstId}`);
  const current = signal.body.current;
  checks.push({ name: "provider-response", ok: signal.status === 200 && signal.body.resultClass === "ok-data", httpStatus: signal.status, resultClass: signal.body.resultClass ?? null, error: signal.body.error ?? null });
  checks.push({ name: "fresh-pedestrian-signal", ok: signal.body.observation?.synchronized === true && signal.body.observation?.fresh === true && current?.pedestrianPresent === true && current?.remainingPresent === true && current.sourceAgeMs !== null && current.sourceAgeMs >= -1000 && current.sourceAgeMs <= 10_000, sourceAgeMs: current?.sourceAgeMs ?? null, observation: signal.body.observation ?? null });
} catch (error) {
  checks.push({ name: "connection", ok: false, error: error instanceof Error ? error.name : "UnknownError" });
}
const report = { checkedAt: new Date().toISOString(), site: new URL(base).origin, itstId, checks,
  fieldGpsValidated: false, futureWaitValidated: false };
console.log(JSON.stringify(report, null, 2));
if (process.env.VERIFY_REPORT_PATH) await writeFile(process.env.VERIFY_REPORT_PATH, JSON.stringify(report, null, 2));
process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
