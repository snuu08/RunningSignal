// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresSeoulStore, createSharedSeoulCalls, sharedSeoulCallsFromEnv, type SqlPool } from "./seoul-shared-calls.ts";
import { createSeoulFeedClient } from "./seoul-feed.ts";
import type { TdataFetchResult } from "../src/real/signals/tdata.ts";

let database: PGlite;
let pool: SqlPool;
const packet = (): TdataFetchResult => ({ service: "current", itstId: "1850", class: "ok-data", httpStatus: 200,
  requestedAtMs: Date.now(), respondedAtMs: Date.now(), lagMs: 0, error: null, retryAfterMs: null,
  rowCount: 1, itstIds: ["1850"], pedestrianKeys: ["ntPdsgStatNm"], remainingKeys: ["ntPdsgRmdrCs"],
  requestUrlRedacted: "https://provider.test?apikey=[redacted]", body: [{ itstId: "1850", trsmUtcTime: Date.now(),
    ntPdsgStatNm: "stop-And-Remain", ntPdsgRmdrCs: 100 }] });

beforeEach(async () => {
  database = new PGlite();
  await database.exec(readFileSync(new URL("../netlify/database/migrations/20261017024000_tdata_shared_calls.sql", import.meta.url), "utf8"));
  // PGlite has one connection. Serialize each transaction in this SQL integration
  // harness; hosted multi-connection exclusion uses the tested FOR UPDATE query.
  let tail = Promise.resolve();
  pool = { async connect() {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    return { query: async (sql, values) => database.query<Record<string, unknown>>(sql, values), release };
  } };
});
afterEach(async () => { await database.close(); });

describe("shared T-DATA quota and snapshots", () => {
  it("coalesces independent workers into one provider call with shared call provenance", async () => {
    const upstream = vi.fn(async () => { await new Promise((r) => setTimeout(r, 30)); return packet(); });
    const a = createSharedSeoulCalls(createPostgresSeoulStore(pool), "test-secret");
    const b = createSharedSeoulCalls(createPostgresSeoulStore(pool), "test-secret");
    const [first, second] = await Promise.all([a.read("current", "1850", upstream), b.read("current", "1850", upstream)]);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(first.coordination?.callId).toBe(second.coordination?.callId);
    expect(first.coordination?.instanceId).not.toBe(second.coordination?.instanceId);
    expect(new Set([first.coordination?.source, second.coordination?.source])).toEqual(new Set(["upstream", "cache"]));
  });
  it("persists a five-minute service reservation even when its owning worker crashes", async () => {
    const store = createPostgresSeoulStore(pool);
    expect((await store.claim("phase", "1850")).kind).toBe("owner");
    await database.query("UPDATE tdata_call_account SET lease_until_ms=0");
    const next = await createPostgresSeoulStore(pool).claim("phase", "9999");
    expect(next).toMatchObject({ kind: "blocked", scope: "service", pendingSame: false });
    if (next.kind === "blocked") expect(next.delay).toBeGreaterThan(290_000);
  });
  it("shares unknown 429 backoff across services, keys and warm cached successes", async () => {
    const a = createSharedSeoulCalls(createPostgresSeoulStore(pool), "test-secret");
    const b = createSharedSeoulCalls(createPostgresSeoulStore(pool), "another-secret");
    const ok = vi.fn(async () => packet());
    await a.read("current", "1850", ok);
    await b.read("phase", "1850", async () => ({ ...packet(), service: "phase", class: "rate-limited", httpStatus: 429,
      retryAfterMs: 120_000, rateLimitScope: "account", body: null }));
    const blocked = await a.read("current", "1850", ok);
    expect(blocked).toMatchObject({ class: "rate-limited", body: null, coordination: { source: "blocked" } });
    expect(blocked.retryAfterMs).toBeGreaterThan(119_000);
    expect(ok).toHaveBeenCalledTimes(1);
  });
  it("isolates only explicitly scoped service limits and preserves their Retry-After", async () => {
    const a = createSharedSeoulCalls(createPostgresSeoulStore(pool), "test-secret");
    await a.read("phase", "1850", async () => ({ ...packet(), service: "phase", class: "rate-limited", httpStatus: 429,
      retryAfterMs: 232_000, rateLimitScope: "service", body: null }));
    const b = createSharedSeoulCalls(createPostgresSeoulStore(pool), "test-secret");
    const upstream = vi.fn(async () => packet());
    expect(await b.read("phase", "9999", upstream)).toMatchObject({ class: "rate-limited", rateLimitScope: "service" });
    expect(await b.read("current", "1850", upstream)).toMatchObject({ class: "ok-data" });
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("blocks another intersection instead of fanning out while any account call is pending", async () => {
    await createPostgresSeoulStore(pool).claim("current", "1850");
    const upstream = vi.fn(async () => packet());
    const result = await createSharedSeoulCalls(createPostgresSeoulStore(pool), "test-secret").read("timing-current", "9999", upstream);
    expect(result).toMatchObject({ class: "rate-limited", coordination: { source: "blocked" } });
    expect(upstream).not.toHaveBeenCalled();
  });
  it("rejects a late worker's completion after its lease has been replaced", async () => {
    const store = createPostgresSeoulStore(pool);
    const claim = await store.claim("current", "1850");
    expect(claim.kind).toBe("owner");
    await database.query("UPDATE tdata_call_account SET lease_until_ms=0");
    await database.query("UPDATE tdata_call_service SET next_call_ms=0");
    const replacement = await store.claim("current", "9999");
    expect(replacement.kind).toBe("owner");
    if (claim.kind === "owner") await expect(store.finish("current", "1850", claim.token, packet())).rejects.toThrow("coordination_lease_lost");
    expect((await database.query("SELECT * FROM tdata_call_cache")).rows).toEqual([]);
  });
  it("removes credentials from both stored snapshots and returned payloads", async () => {
    const result = await createSharedSeoulCalls(createPostgresSeoulStore(pool), "test-secret").read("current", "1850",
      async () => ({ ...packet(), body: { apikey: "test-secret", message: "failed test-secret" } }));
    expect(JSON.stringify(result)).not.toContain("test-secret");
    expect(JSON.stringify((await database.query("SELECT payload FROM tdata_call_cache")).rows)).not.toContain("test-secret");
  });
  it("fails closed before upstream access when the shared database is unavailable", async () => {
    const upstream = vi.fn(async () => packet());
    const broken = { claim: async () => { throw new Error("postgres://private-password"); }, finish: vi.fn() };
    const result = await createSharedSeoulCalls(broken, "test-secret").read("current", "1850", upstream);
    expect(result).toMatchObject({ class: "connect", error: "coordination_unavailable", body: null });
    expect(JSON.stringify(result)).not.toContain("private-password");
    expect(upstream).not.toHaveBeenCalled();
  });
  it("does not treat a cached source packet as a new fresh observation", async () => {
    const old = packet();
    (old.body as Record<string, unknown>[])[0].trsmUtcTime = Date.now() - 11_000;
    const shared = createSharedSeoulCalls(createPostgresSeoulStore(pool), "test-secret");
    const fetcher = vi.fn(async () => Response.json(old.body));
    const a = createSeoulFeedClient("test-secret", fetcher, undefined, shared);
    await a.snapshot("1850");
    const b = createSeoulFeedClient("test-secret", fetcher, undefined,
      createSharedSeoulCalls(createPostgresSeoulStore(pool), "test-secret"));
    const snapshot = await b.snapshot("1850");
    expect(snapshot.fresh).toBe(false);
    expect(snapshot.result.coordination?.source).toBe("cache");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never spends production provider quota from an isolated preview database", async () => {
    const upstream = vi.fn(async () => packet());
    const shared = sharedSeoulCallsFromEnv({ CONTEXT: "deploy-preview" }, "test-secret")!;
    expect(await shared.read("current", "1850", upstream)).toMatchObject({ error: "live_calls_disabled_in_preview" });
    expect(upstream).not.toHaveBeenCalled();
  });
});
