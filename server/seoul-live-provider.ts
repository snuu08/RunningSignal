import { pathLength, type Route } from "../src/real/core.ts";
import { crossingsAlongRoute } from "../src/real/signals/along-route.ts";
import {
  createVerifiedProvider,
  type PredictionScope,
  type TdataPedestrianMapping,
  type VerifiedBundle,
} from "../src/real/signals/provider.ts";
import { planAppliesAt, selectOperatingPlan } from "../src/real/signals/select-plan.ts";
import type { OperatingPlanRecord } from "../src/real/signals/schema.ts";
import { latestTdataRow, sourceTimeOf } from "../src/real/signals/tdata.ts";
import { LIVE_SIGNAL_MAX_HORIZON_SEC, seoulLiveWindow, tdataMappingIsVerified, type LiveSignalWindow } from "../src/real/signals/live-window.ts";
import { toRuntimeCrossing } from "../src/real/signals/to-engine.ts";
import type { SeoulCredentials } from "./seoul-keys.ts";
import { createSeoulFeedClient } from "./seoul-feed.ts";
import type { RouteSignalProvider } from "./signal-service.ts";

/** Match a known fixed plan to the live pedestrian head. Never derive a cycle. */
export function confirmSeoulPlan(
  plan: OperatingPlanRecord,
  mapping: TdataPedestrianMapping,
  body: unknown,
  nowMs: number,
): OperatingPlanRecord | null {
  if (!tdataMappingIsVerified(mapping, nowMs)) return null;
  if (plan.source !== "tdata" || plan.synthetic || plan.stage !== "verified" ||
    plan.operationMode !== "fixed" || plan.planVerifiedAt === null ||
    !Number.isFinite(plan.epochMs) || !(plan.cycleSec > 0) ||
    !(plan.entryStartSec >= 0 && plan.entryEndSec > plan.entryStartSec &&
      plan.clearEndSec >= plan.entryEndSec && plan.clearEndSec <= plan.cycleSec) ||
    !(plan.uncertaintySec >= 0 && plan.uncertaintySec <= 3)) return null;
  const row = latestTdataRow(body, plan.sourceIntersectionId);
  const at = row ? sourceTimeOf(row) : null;
  if (at === null || nowMs - at > 10_000 || at > nowMs + 1000 ||
    at < plan.validFromMs || at > plan.validToMs || !planAppliesAt(plan, at)) return null;
  if (!row) return null;
  const raw = row[`${mapping.direction}PdsgRmdrCs`];
  if (raw == null || raw === "" || typeof raw === "boolean" || !Number.isFinite(Number(raw)) || Number(raw) < 0)
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

export function hasSeoulLiveMappings(bundle: VerifiedBundle, scopes: PredictionScope[], nowMs: number) {
  return (bundle.liveMappings ?? []).some((mapping) => {
    const crossing = bundle.crossings.find((c) => c.internalId === mapping.crossingInternalId && c.source === "tdata");
    return crossing && tdataMappingIsVerified(mapping, nowMs) &&
      (bundle.liveMappings ?? []).filter((m) => m.crossingInternalId === crossing.internalId).length === 1 &&
      scopes.some((s) => s.source === crossing.source && s.sourceIntersectionId === crossing.sourceIntersectionId) &&
      toRuntimeCrossing(crossing, null, nowMs, 0) !== null &&
      bundle.surveys.some((s) => s.complete && s.crossingInternalIds.includes(crossing.internalId));
  });
}

/** Share source observations across candidates; live windows need no invented plan. */
export function createSeoulLiveProvider(
  bundle: VerifiedBundle,
  scopes: PredictionScope[],
  apiKey: SeoulCredentials,
  fetcher: typeof fetch,
  nowMs: () => number = () => Date.now(),
  feed = createSeoulFeedClient(apiKey, fetcher, nowMs),
): RouteSignalProvider {
  return {
    async inspect(route: Route, departureMs: number, context?: { paceSecPerKm: number; traveledM: number }) {
      const hits = crossingsAlongRoute(route, bundle.crossings);
      const confirmed = new Map<OperatingPlanRecord, OperatingPlanRecord>();
      const windows = new Map<string, LiveSignalWindow>();
      let retryAfterMs = 0;
      const geometryM = pathLength(route.coordinates);
      const distanceScale = geometryM > 0 ? route.distanceM / geometryM : 1;
      await Promise.all(hits.map(async ({ crossing, entryAtM }) => {
        if (crossing.source !== "tdata" || !scopes.some((s) =>
          s.source === crossing.source && s.sourceIntersectionId === crossing.sourceIntersectionId)) return;
        const mappings = (bundle.liveMappings ?? []).filter((m) => m.crossingInternalId === crossing.internalId);
        if (mappings.length !== 1) return;
        if (!tdataMappingIsVerified(mappings[0], nowMs())) return;
        const plan = selectOperatingPlan(bundle.plans, crossing, departureMs).plan;
        const remainM = entryAtM * distanceScale - (context?.traveledM ?? 0);
        if (remainM < 0 || (!plan && context && remainM * context.paceSecPerKm / 1000 > LIVE_SIGNAL_MAX_HORIZON_SEC)) return;
        const live = await feed.snapshot(crossing.sourceIntersectionId);
        retryAfterMs = Math.max(retryAfterMs, live.retryAfterMs ?? 0);
        if (!live.synchronized || !live.fresh || live.result.class !== "ok-data") return;
        const window = seoulLiveWindow(live.data, crossing.sourceIntersectionId, mappings[0], nowMs());
        if (window) windows.set(crossing.internalId, window);
        if (plan) {
          const match = confirmSeoulPlan(plan, mappings[0], live.data, nowMs());
          if (match) confirmed.set(plan, match);
        }
      }));
      const checked: VerifiedBundle = {
        ...bundle,
        plans: bundle.plans.map((plan) => plan.source === "tdata"
          ? confirmed.get(plan) ?? { ...plan, currentPlanConfirmedAt: null }
          : plan),
      };
      const result = await createVerifiedProvider(checked, scopes, nowMs).inspect(route, departureMs);
      return { ...result, retryAfterMs: Math.max(retryAfterMs, feed.retryAfterMs() ?? 0) || null,
        crossings: result.crossings.map((c) => ({
          ...c, ...(result.completeCoverage && windows.has(c.id) ? { liveWindow: windows.get(c.id)! } : {}),
        })) };
    },
  };
}
