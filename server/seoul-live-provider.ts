import type { Route } from "../src/real/core.ts";
import { crossingsAlongRoute } from "../src/real/signals/along-route.ts";
import {
  createVerifiedProvider,
  type PredictionScope,
  type TdataPedestrianMapping,
  type VerifiedBundle,
} from "../src/real/signals/provider.ts";
import { planAppliesAt, selectOperatingPlan } from "../src/real/signals/select-plan.ts";
import type { OperatingPlanRecord } from "../src/real/signals/schema.ts";
import { fetchTdataService, interpretCurrentState, rowsOf } from "../src/real/signals/tdata.ts";
import type { RouteSignalProvider } from "./signal-service.ts";

/** Match a known fixed plan to the live pedestrian head. Never derive a cycle. */
export function confirmSeoulPlan(
  plan: OperatingPlanRecord,
  mapping: TdataPedestrianMapping,
  body: unknown,
  nowMs: number,
): OperatingPlanRecord | null {
  if (!/^(nt|et|st|wt|ne|se|sw|nw)$/.test(mapping.direction) ||
    !["deciseconds", "centiseconds"].includes(mapping.remainingUnit) ||
    !Number.isFinite(mapping.verifiedAtMs) || mapping.verifiedAtMs <= 0 ||
    mapping.verifiedAtMs > nowMs || !mapping.evidence?.trim()) return null;
  if (plan.source !== "tdata" || plan.synthetic || plan.stage !== "verified" ||
    plan.operationMode !== "fixed" || plan.planVerifiedAt === null ||
    !Number.isFinite(plan.epochMs) || !(plan.cycleSec > 0) ||
    !(plan.entryStartSec >= 0 && plan.entryEndSec > plan.entryStartSec &&
      plan.clearEndSec >= plan.entryEndSec && plan.clearEndSec <= plan.cycleSec) ||
    !(plan.uncertaintySec >= 0 && plan.uncertaintySec <= 3)) return null;
  const current = interpretCurrentState(body, nowMs, "current", plan.sourceIntersectionId);
  const at = current.sourceTimestampMs;
  if (at === null || nowMs - at > 10_000 || at > nowMs + 1000 ||
    at < plan.validFromMs || at > plan.validToMs || !planAppliesAt(plan, at)) return null;
  const row = rowsOf(body).find((r) => String(r.itstId) === plan.sourceIntersectionId &&
    Number(r.trsmUtcTime) === at);
  if (!row) return null;
  const raw = row[`${mapping.direction}PdsgRmdrCs`];
  if (raw == null || raw === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0)
    return null;
  const state = String(row[`${mapping.direction}PdsgStatNm`] ?? "").toLowerCase();
  const phase = (((at - plan.epochMs) / 1000) % plan.cycleSec + plan.cycleSec) % plan.cycleSec;
  const greenEnd = plan.flashStartSec ?? plan.entryEndSec;
  let expectedRemaining: number | null = null;
  if (state === "protected-movement-allowed" && phase >= plan.entryStartSec && phase < greenEnd)
    expectedRemaining = greenEnd - phase;
  if (state === "stop-and-remain" && mapping.redEndsAtEntryStart === true &&
    (phase < plan.entryStartSec || phase >= plan.clearEndSec))
    expectedRemaining = phase < plan.entryStartSec
      ? plan.entryStartSec - phase
      : plan.cycleSec - phase + plan.entryStartSec;
  const remaining = Number(raw) / (mapping.remainingUnit === "deciseconds" ? 10 : 100);
  if (expectedRemaining === null || Math.abs(remaining - expectedRemaining) > Math.max(1, plan.uncertaintySec))
    return null;
  return { ...plan, observedAt: at, fetchedAt: nowMs, currentPlanConfirmedAt: at };
}

/** One intersection fetch per assessment, shared across its candidate routes. */
export function createSeoulLiveProvider(
  bundle: VerifiedBundle,
  scopes: PredictionScope[],
  apiKey: string,
  fetcher: typeof fetch,
  nowMs: () => number = () => Date.now(),
): RouteSignalProvider {
  const calls = new Map<string, Promise<unknown>>();
  async function snapshot(itstId: string) {
    let call = calls.get(itstId);
    if (!call) {
      call = fetchTdataService("current", apiKey, fetcher, { itstId })
        .then((r) => r.class === "ok-data" ? r.body : null);
      calls.set(itstId, call);
    }
    return call;
  }
  return {
    async inspect(route: Route, departureMs: number) {
      const hits = crossingsAlongRoute(route, bundle.crossings);
      const confirmed = new Map<OperatingPlanRecord, OperatingPlanRecord>();
      await Promise.all(hits.map(async ({ crossing }) => {
        if (crossing.source !== "tdata" || !scopes.some((s) =>
          s.source === crossing.source && s.sourceIntersectionId === crossing.sourceIntersectionId)) return;
        const mappings = (bundle.liveMappings ?? []).filter((m) => m.crossingInternalId === crossing.internalId);
        if (mappings.length !== 1) return;
        const plan = selectOperatingPlan(bundle.plans, crossing, departureMs).plan;
        if (!plan) return;
        const live = await snapshot(crossing.sourceIntersectionId);
        const match = confirmSeoulPlan(plan, mappings[0], live, nowMs());
        if (match) confirmed.set(plan, match);
      }));
      const checked: VerifiedBundle = {
        ...bundle,
        plans: bundle.plans.map((plan) => plan.source === "tdata"
          ? confirmed.get(plan) ?? { ...plan, currentPlanConfirmedAt: null }
          : plan),
      };
      return createVerifiedProvider(checked, scopes, nowMs).inspect(route, departureMs);
    },
  };
}
