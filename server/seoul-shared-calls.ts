import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { redactValue } from "../src/real/signals/redact.ts";
import type { TdataCallId, TdataFetchResult } from "../src/real/signals/tdata.ts";
import type { SeoulCredentials } from "./seoul-keys.ts";

// Conservative application budgets. Historical/MAP requests wait five minutes
// across intersection IDs and keys; provider Retry-After can extend that wait.
export const TDATA_CALL_INTERVAL_MS: Record<TdataCallId, number> = {
  current: 2000, "phase-current": 2000, "timing-current": 2000,
  phase: 300_000, timing: 300_000, connection: 300_000, lane: 300_000,
};
const LEASE_MS = 30_000;
const ACCOUNT = "tdata-account-v1";
type SqlClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
};
export type SqlPool = { connect(): Promise<SqlClient> };
type Claim =
  | { kind: "owner"; token: string }
  | { kind: "cached"; result: TdataFetchResult; token: string }
  | { kind: "blocked"; delay: number; scope: "account" | "service"; pendingSame: boolean };

async function connect(pool: SqlPool): Promise<SqlClient> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const pending = pool.connect().then((client) => {
    if (expired) { client.release(); throw new Error("coordination_unavailable"); }
    return client;
  });
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error("coordination_unavailable")); }, 2500);
    })]);
  } finally { clearTimeout(timer!); }
}

export function createPostgresSeoulStore(pool: SqlPool) {
  async function transaction<T>(operation: (client: SqlClient) => Promise<T>) {
    const client = await connect(pool);
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '2000ms'");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  return {
    async claim(service: TdataCallId, itstId: string): Promise<Claim> {
      return transaction(async (client) => {
        const id = `${service}:${itstId}`;
        await client.query("INSERT INTO tdata_call_account (id) VALUES ($1) ON CONFLICT DO NOTHING", [ACCOUNT]);
        const account = (await client.query("SELECT * FROM tdata_call_account WHERE id=$1 FOR UPDATE", [ACCOUNT])).rows[0];
        // Use database time after obtaining the lock. Runtime clocks never grant quota.
        const at = Number((await client.query("SELECT floor(extract(epoch FROM clock_timestamp())*1000) AS ms")).rows[0].ms);
        await client.query("INSERT INTO tdata_call_service (id) VALUES ($1) ON CONFLICT DO NOTHING", [service]);
        const gate = (await client.query("SELECT * FROM tdata_call_service WHERE id=$1 FOR UPDATE", [service])).rows[0];
        const accountDelay = Number(account.blocked_until_ms) - at;
        const serviceDelay = Number(gate.blocked_until_ms) - at;
        if (accountDelay > 0 || serviceDelay > 0) return { kind: "blocked", delay: Math.max(accountDelay, serviceDelay),
          scope: accountDelay >= serviceDelay ? "account" : "service", pendingSame: false };
        const cached = (await client.query("SELECT * FROM tdata_call_cache WHERE id=$1 AND expires_at_ms>$2", [id, at])).rows[0];
        if (cached) return { kind: "cached", result: cached.payload as TdataFetchResult, token: String(cached.call_id) };
        const leaseDelay = Number(account.lease_until_ms) - at;
        if (leaseDelay > 0) return { kind: "blocked", delay: leaseDelay, scope: "account", pendingSame: account.lease_request === id };
        if (Number(gate.next_call_ms) > at) return { kind: "blocked", delay: Number(gate.next_call_ms) - at,
          scope: "service", pendingSame: false };
        const token = randomUUID();
        await client.query("UPDATE tdata_call_account SET lease_until_ms=$2,lease_token=$3,lease_request=$4 WHERE id=$1",
          [ACCOUNT, at + LEASE_MS, token, id]);
        // Commit the reservation BEFORE the network call. A crashed worker cannot
        // roll it back and immediately spend the same provider allowance again.
        await client.query("UPDATE tdata_call_service SET next_call_ms=$2 WHERE id=$1", [service, at + TDATA_CALL_INTERVAL_MS[service]]);
        await client.query("DELETE FROM tdata_call_cache WHERE expires_at_ms <= $1", [at]);
        return { kind: "owner", token };
      });
    },
    async finish(service: TdataCallId, itstId: string, token: string, result: TdataFetchResult) {
      return transaction(async (client) => {
        const account = (await client.query("SELECT * FROM tdata_call_account WHERE id=$1 FOR UPDATE", [ACCOUNT])).rows[0];
        if (!account || account.lease_token !== token) throw new Error("coordination_lease_lost");
        const at = Number((await client.query("SELECT floor(extract(epoch FROM clock_timestamp())*1000) AS ms")).rows[0].ms);
        if (Number(account.lease_until_ms) <= at) throw new Error("coordination_lease_lost");
        const quotaDelay = result.class === "rate-limited" ? Math.max(60_000, result.retryAfterMs ?? 0) : 0;
        if (quotaDelay && result.rateLimitScope !== "service")
          await client.query("UPDATE tdata_call_account SET blocked_until_ms=greatest(blocked_until_ms,$2) WHERE id=$1", [ACCOUNT, at + quotaDelay]);
        await client.query(`UPDATE tdata_call_service SET next_call_ms=greatest(next_call_ms,$2),
          blocked_until_ms=greatest(blocked_until_ms,$3) WHERE id=$1`,
          [service, at + TDATA_CALL_INTERVAL_MS[service], result.rateLimitScope === "service" ? at + quotaDelay : 0]);
        const ttl = result.httpStatus === 404 || result.class === "auth" ? 60_000
          : result.class === "ok-data" || result.class === "ok-empty" ? TDATA_CALL_INTERVAL_MS[service] : 10_000;
        await client.query(`INSERT INTO tdata_call_cache(id,expires_at_ms,call_id,payload) VALUES($1,$2,$3,$4::jsonb)
          ON CONFLICT(id) DO UPDATE SET expires_at_ms=excluded.expires_at_ms,call_id=excluded.call_id,payload=excluded.payload`,
          [`${service}:${itstId}`, at + ttl, token, JSON.stringify(result)]);
        await client.query("UPDATE tdata_call_account SET lease_until_ms=0,lease_token=NULL,lease_request=NULL WHERE id=$1", [ACCOUNT]);
      });
    },
  };
}

export type SeoulSharedStore = ReturnType<typeof createPostgresSeoulStore>;
export type SeoulSharedCalls = ReturnType<typeof createSharedSeoulCalls>;
function denied(service: TdataCallId, itstId: string, error: string, delay: number | null = null,
  scope: "account" | "service" = "account"): TdataFetchResult {
  const at = Date.now();
  return { service, itstId, class: delay ? "rate-limited" : "connect", httpStatus: delay ? 429 : null,
    requestedAtMs: at, respondedAtMs: at, lagMs: 0, error, retryAfterMs: delay, rateLimitScope: scope,
    rowCount: 0, itstIds: [], pedestrianKeys: [], remainingKeys: [], requestUrlRedacted: "", body: null };
}

/** No memory-only fallback: database failure must never spend upstream quota. */
export function createSharedSeoulCalls(store: SeoulSharedStore, credentials: SeoulCredentials,
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {
  const instanceId = randomUUID();
  const secrets = typeof credentials === "string" ? [credentials] : Object.values(credentials).filter((v): v is string => !!v);
  return {
    async read(service: TdataCallId, itstId: string, upstream: () => Promise<TdataFetchResult>): Promise<TdataFetchResult> {
      try {
        let claim = await store.claim(service, itstId);
        // Other instances wait only for this exact in-flight request; unrelated
        // intersections receive Retry-After and cannot create an upstream fan-out.
        for (let i = 0; claim.kind === "blocked" && claim.pendingSame && i < 13; i++) {
          await wait(500);
          claim = await store.claim(service, itstId);
        }
        if (claim.kind === "blocked") return { ...denied(service, itstId, "shared_call_backoff", claim.delay, claim.scope),
          coordination: { mode: "shared-database", source: "blocked", instanceId } };
        if (claim.kind === "cached") return { ...claim.result,
          coordination: { mode: "shared-database", source: "cache", callId: claim.token, instanceId } };
        const result = redactValue(await upstream(), secrets) as TdataFetchResult;
        await store.finish(service, itstId, claim.token, result);
        return { ...result, coordination: { mode: "shared-database", source: "upstream", callId: claim.token, instanceId } };
      } catch {
        return { ...denied(service, itstId, "coordination_unavailable"),
          coordination: { mode: "shared-database", source: "unavailable", instanceId } };
      }
    },
  };
}

let productionCalls: SeoulSharedCalls | undefined;
let productionSignature = "";
let productionStore: SeoulSharedStore | undefined;
export function sharedSeoulCallsFromEnv(env: Record<string, string | undefined>, credentials: SeoulCredentials): SeoulSharedCalls | undefined {
  if (env.SIGNAL_CALL_COORDINATION !== "required" && env.NETLIFY !== "true" && !env.CONTEXT && !env.NETLIFY_DB_URL) return undefined;
  // Netlify preview databases are isolated. Never let a preview spend the same
  // production provider account through a separate quota database.
  if ((env.CONTEXT && env.CONTEXT !== "production") || env.SIGNAL_DEPLOY_PUBLISHED === "false") return {
    read: async (service, itstId) => denied(service, itstId, "live_calls_disabled_in_preview"),
  };
  const signature = JSON.stringify(credentials);
  if (!productionCalls || signature !== productionSignature) {
    const store = () => productionStore ??= createPostgresSeoulStore(getDatabase().pool as SqlPool);
    productionCalls = createSharedSeoulCalls({
      claim: (service, id) => store().claim(service, id),
      finish: (service, id, token, result) => store().finish(service, id, token, result),
    }, credentials);
    productionSignature = signature;
  }
  return productionCalls;
}
