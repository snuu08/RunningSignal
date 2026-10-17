import {
  fetchTdataService, rowsOf, sourceTimeOf,
  type TdataCallId, type TdataFetchResult,
} from "../src/real/signals/tdata.ts";
import { LIVE_SIGNAL_MAX_AGE_MS } from "../src/real/signals/live-window.ts";

import { seoulKeyFor, type SeoulCredentials } from "./seoul-keys.ts";

const CACHE_MS = 2000;
const DEFAULT_BACKOFF_MS = 60_000;
const MAX_CACHE_ENTRIES = 128;
type Row = Record<string, unknown>;
export type SeoulObservation = {
  source: "fusion" | "current-phase+timing";
  data: unknown;
  result: TdataFetchResult;
  synchronized: boolean;
  sourceTimestampMs: number | null;
  sourceAgeMs: number | null;
  fresh: boolean;
  issues: string[];
  retryAfterMs: number | null;
};

/** Reject conflicting packets at the newest source instant, including duplicates. */
function newestUnique(body: unknown, itstId: string): Row | null {
  const rows = rowsOf(body).filter((r) => String(r.itstId) === itstId && sourceTimeOf(r) !== null);
  const at = Math.max(...rows.map((r) => sourceTimeOf(r)!));
  const newest = rows.filter((r) => sourceTimeOf(r) === at);
  if (!newest.length) return null;
  const relevant = (r: Row) => JSON.stringify(Object.entries(r)
    .filter(([k]) => /^(dataId|eqmnId)$|Pdsg(StatNm|RmdrCs)$/.test(k))
    .sort(([a], [b]) => a.localeCompare(b)));
  if (newest.some((r) => relevant(r) !== relevant(newest[0]))) return null;
  return { ...newest[0], trsmUtcTime: at };
}

/** Two successful HTTP responses are not necessarily the same signal packet. */
export function joinSeoulPhaseTiming(phase: unknown, timing: unknown, itstId: string): Row | null {
  const a = newestUnique(phase, itstId), b = newestUnique(timing, itstId);
  if (!a || !b || sourceTimeOf(a) !== sourceTimeOf(b)) return null;
  for (const key of ["dataId", "eqmnId"])
    if ((a[key] != null || b[key] != null) && String(a[key] ?? "") !== String(b[key] ?? ""))
      return null;
  const merged = { ...a, ...b };
  for (const key of Object.keys(a).filter((k) => /Pdsg(StatNm|RmdrCs)$/.test(k)))
    if (a[key] != null && a[key] !== "") {
      if (b[key] != null && b[key] !== "" && String(a[key]) !== String(b[key])) return null;
      merged[key] = a[key];
    }
  return merged;
}

function hasPedestrianPair(row: Row | null): boolean {
  return !!row && ["nt", "et", "st", "wt", "ne", "se", "sw", "nw"].some((d) =>
    typeof row[`${d}PdsgStatNm`] === "string" && String(row[`${d}PdsgStatNm`]).trim() &&
    row[`${d}PdsgRmdrCs`] != null && row[`${d}PdsgRmdrCs`] !== "" &&
    Number.isFinite(Number(row[`${d}PdsgRmdrCs`])) && Number(row[`${d}PdsgRmdrCs`]) >= 0);
}

export function createSeoulFeedClient(credentials: SeoulCredentials, fetcher: typeof fetch, nowMs = () => Date.now()) {
  const calls = new Map<string, { expiresAt: number; value: Promise<TdataFetchResult> }>();
  const serviceBlockedUntilMs = new Map<TdataCallId, number>();
  // Different dataset keys may still belong to one provider account.
  // Unknown limits stay account-wide; only explicit API limits are isolated.
  let blockedUntilMs = 0;
  const retryAfterMs = (service?: TdataCallId) => Math.max(0,
    blockedUntilMs - nowMs(), (service ? serviceBlockedUntilMs.get(service) ?? 0 : 0) - nowMs()) || null;
  const failureRetryAfterMs = (result: TdataFetchResult) => retryAfterMs(result.service) ??
    (result.class !== "ok-data" && result.class !== "ok-empty"
      ? Math.max(0, (calls.get(`${result.service}:${result.itstId}`)?.expiresAt ?? nowMs()) - nowMs()) || null
      : null);

  async function read(service: TdataCallId, itstId: string): Promise<TdataFetchResult> {
    const at = nowMs();
    const apiKey = seoulKeyFor(credentials, service);
    if (!apiKey) return {
      service, itstId, class: "auth", httpStatus: null, requestedAtMs: at,
      respondedAtMs: at, lagMs: 0, error: "missing_api_key", retryAfterMs: null,
      rowCount: 0, itstIds: [], pedestrianKeys: [], remainingKeys: [], requestUrlRedacted: "", body: null,
    };
    const delay = retryAfterMs(service);
    if (delay !== null) return {
      service, itstId, class: "rate-limited", httpStatus: 429, requestedAtMs: at,
      respondedAtMs: at, lagMs: 0, error: "rate_limit_backoff", retryAfterMs: delay,
      rateLimitScope: blockedUntilMs > at ? "account" : "service",
      rowCount: 0, itstIds: [], pedestrianKeys: [], remainingKeys: [], requestUrlRedacted: "", body: null,
    };
    const cacheKey = `${service}:${itstId}`;
    const cached = calls.get(cacheKey);
    if (cached && cached.expiresAt > at) return cached.value;
    if (calls.size >= MAX_CACHE_ENTRIES) calls.delete(calls.keys().next().value!);
    const entry = { expiresAt: Infinity, value: null as unknown as Promise<TdataFetchResult> };
    entry.value = fetchTdataService(service, apiKey, fetcher, {
      itstId, numOfRows: "20", timeoutMs: 6000,
    }).then((result) => {
      if (result.class === "rate-limited") {
        const until = nowMs() + Math.max(DEFAULT_BACKOFF_MS, result.retryAfterMs ?? 0);
        if (result.rateLimitScope === "service")
          serviceBlockedUntilMs.set(service, Math.max(serviceBlockedUntilMs.get(service) ?? 0, until));
        else blockedUntilMs = Math.max(blockedUntilMs, until);
      }
      entry.expiresAt = nowMs() + (result.httpStatus === 404 || result.class === "auth"
        ? DEFAULT_BACKOFF_MS : result.class === "ok-data" || result.class === "ok-empty" ? CACHE_MS : 10_000);
      return result;
    });
    calls.set(cacheKey, entry);
    return entry.value;
  }

  function observation(source: SeoulObservation["source"], result: TdataFetchResult, row: Row | null,
    data: unknown, extraIssues: string[] = []): SeoulObservation {
    const sourceTimestampMs = row ? sourceTimeOf(row) : null;
    const sourceAgeMs = sourceTimestampMs === null ? null : nowMs() - sourceTimestampMs;
    const synchronized = hasPedestrianPair(row);
    const fresh = sourceAgeMs !== null && sourceAgeMs >= -1000 && sourceAgeMs <= LIVE_SIGNAL_MAX_AGE_MS;
    const issues = [...extraIssues];
    if (!synchronized) issues.push("unpaired-pedestrian-state");
    if (sourceAgeMs === null) issues.push("missing-source-time");
    else if (!fresh) issues.push(sourceAgeMs < -1000 ? "future-source-time" : "stale-source-time");
    if (result.class !== "ok-data" && result.class !== "ok-empty") issues.push(result.class);
    return { source, data, result, synchronized, sourceTimestampMs, sourceAgeMs, fresh,
      issues: [...new Set(issues)], retryAfterMs: failureRetryAfterMs(result) };
  }

  async function snapshot(itstId: string): Promise<SeoulObservation> {
    const current = seoulKeyFor(credentials, "current") ? await read("current", itstId) : null;
    const row = current ? newestUnique(current.body, itstId) : null;
    if (current?.class === "ok-data" && hasPedestrianPair(row))
      return observation("fusion", current, row, [row]);
    // A missing/empty fusion service may use the two current-only endpoints.
    // Historical phase/timing are diagnostic services, never an automatic live fallback.
    // Never fan out after authentication, quota or connection failures.
    if (current && !(current.httpStatus === 404 || current.class === "ok-empty" || current.class === "ok-data"))
      return observation("fusion", current, null, null);
    const [phase, timing] = await Promise.all([read("phase-current", itstId), read("timing-current", itstId)]);
    const failure = [phase, timing].find((r) => r.class === "rate-limited") ??
      [phase, timing].find((r) => r.class !== "ok-data" && r.class !== "ok-empty");
    if (failure) return observation("current-phase+timing", failure, null, null, ["fusion-unavailable"]);
    const joined = joinSeoulPhaseTiming(phase.body, timing.body, itstId);
    return observation("current-phase+timing", phase, joined,
      joined ? [joined] : phase.body, ["fusion-unavailable", ...(joined ? [] : ["source-packets-differ"])]);
  }
  return { read, snapshot, retryAfterMs };
}

// Coalescing/backoff survives warm requests. It is not a distributed quota guarantee.
let clients = new WeakMap<typeof fetch, { signature: string; client: ReturnType<typeof createSeoulFeedClient> }>();
export function seoulFeedClient(credentials: SeoulCredentials, fetcher: typeof fetch) {
  const signature = JSON.stringify(credentials);
  let saved = clients.get(fetcher);
  if (!saved || saved.signature !== signature) {
    saved = { signature, client: createSeoulFeedClient(credentials, fetcher) };
    clients.set(fetcher, saved);
  }
  return saved.client;
}
export function resetSeoulFeedClientsForTests() { clients = new WeakMap(); }
