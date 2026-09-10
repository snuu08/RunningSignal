/**
 * Freshness vs document age.
 *
 * `ENGINE_PLAN_APPLIED_MAX_AGE_MS` is the forecast() check on
 * FixedPlan.verifiedAtMs. That field means **currentPlanConfirmedAt**:
 * "we confirmed this plan is the one running now", not the date the
 * TOD document was reviewed and not the HTTP fetch time.
 *
 * Do not copy fetchedAt or the request clock onto verifiedAtMs.
 * Do not relax 60s until a replacement applied-plan policy is written
 * against field error. Document verification can be days old; applied
 * confirmation cannot.
 */
export const ENGINE_PLAN_APPLIED_MAX_AGE_MS = 60_000;
export const ENGINE_PLAN_CLOCK_SKEW_MS = 1_000;

export type SignalTimestamps = {
  /** When the operating-plan document/mapping was reviewed. */
  planVerifiedAt: number | null;
  /** Field observation instant (device clock, after clock-error correction). */
  observedAt: number | null;
  /** When this process received a provider HTTP body. */
  fetchedAt: number | null;
  /** When we confirmed the named plan is the one actually running. */
  currentPlanConfirmedAt: number | null;
};

/** Epoch ms number, digit string, or ISO date. Request clocks are not applied-plan time. */
export function parseTimestampMs(value: unknown): number | null {
  if (value === "" || value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (/^\d{10,}$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

export function timestampsFromUnknown(
  raw: Record<string, unknown>,
): SignalTimestamps {
  const n = (k: string) => parseTimestampMs(raw[k]);
  return {
    planVerifiedAt: n("planVerifiedAt"),
    observedAt: n("observedAt"),
    fetchedAt: n("fetchedAt"),
    currentPlanConfirmedAt: n("currentPlanConfirmedAt"),
  };
}

export function appliedPlanIsFresh(
  currentPlanConfirmedAt: number | null,
  nowMs: number,
): boolean {
  if (currentPlanConfirmedAt === null) return false;
  if (currentPlanConfirmedAt > nowMs + ENGINE_PLAN_CLOCK_SKEW_MS) return false;
  return nowMs - currentPlanConfirmedAt <= ENGINE_PLAN_APPLIED_MAX_AGE_MS;
}

/** Never treat fetch/request time as applied-plan confirmation. */
export function engineVerifiedAtMs(ts: SignalTimestamps): number | null {
  return ts.currentPlanConfirmedAt;
}
