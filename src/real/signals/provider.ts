import { progressOnRoute, samplePath, type Coord, type Crossing, type Route } from "../core.ts";
import type { CrossingRecord, OperatingPlanRecord } from "./schema.ts";
import { crossingsAlongRoute } from "./along-route.ts";
import { selectOperatingPlan } from "./select-plan.ts";
import { planFitsCrossing, toRuntimeCrossing } from "./to-engine.ts";

export type CoverageSurvey = {
  id: string;
  complete: boolean;
  coordinates: Coord[];
  crossingInternalIds: string[];
};

export type VerifiedBundle = {
  version: 1;
  synthetic: false;
  crossings: CrossingRecord[];
  plans: OperatingPlanRecord[];
  surveys: CoverageSurvey[];
};

export const EMPTY_VERIFIED_BUNDLE: VerifiedBundle = {
  version: 1,
  synthetic: false,
  crossings: [],
  plans: [],
  surveys: [],
};

export type PredictionScope = {
  source: string;
  sourceIntersectionId: string;
};

export type InspectExclusion = { id: string; reason: string };

export function parsePredictionScopes(raw: string | undefined): PredictionScope[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const i = part.indexOf(":");
      if (i < 1) return [];
      return [{ source: part.slice(0, i), sourceIntersectionId: part.slice(i + 1) }];
    });
}

export function parseVerifiedBundle(raw: unknown): VerifiedBundle {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const crossings = Array.isArray(rec.crossings) ? (rec.crossings as CrossingRecord[]) : [];
  const plans = Array.isArray(rec.plans) ? (rec.plans as OperatingPlanRecord[]) : [];
  const surveys = Array.isArray(rec.surveys) ? (rec.surveys as CoverageSurvey[]) : [];
  return {
    version: 1,
    synthetic: false,
    crossings: crossings.filter((c) => c && c.synthetic !== true && c.stage === "verified"),
    plans: plans.filter((p) => p && p.synthetic !== true && p.stage === "verified"),
    surveys: surveys.filter((s) => s && Array.isArray(s.coordinates)),
  };
}

function surveyCoversRoute(survey: CoverageSurvey, route: Route): boolean {
  if (!survey.complete || survey.coordinates.length < 2 || route.coordinates.length < 2)
    return false;
  return samplePath(route.coordinates, 80).every(
    (p) => progressOnRoute(survey.coordinates, p).offRouteM < 35,
  );
}

function scopeAllows(scopes: PredictionScope[], crossing: CrossingRecord): boolean {
  if (!scopes.length) return false;
  return scopes.some(
    (s) =>
      s.source === crossing.source && s.sourceIntersectionId === crossing.sourceIntersectionId,
  );
}

export function createVerifiedProvider(
  bundle: VerifiedBundle,
  scopes: PredictionScope[],
  nowMs: () => number = () => Date.now(),
) {
  return {
    async inspect(route: Route, departureMs: number) {
      const hits = crossingsAlongRoute(route, bundle.crossings);
      const exclusions: InspectExclusion[] = [];
      const located: Crossing[] = [];
      const freshnessNow = nowMs();
      for (const hit of hits) {
        const { crossing } = hit;
        const selected = selectOperatingPlan(
          bundle.plans,
          {
            source: crossing.source,
            sourceIntersectionId: crossing.sourceIntersectionId,
            pedestrianSignalGroupId: crossing.pedestrianSignalGroupId,
          },
          departureMs,
        );
        if (selected.reason)
          exclusions.push({ id: crossing.internalId, reason: selected.reason });
        let plan = selected.plan;
        if (plan) {
          const mismatch = planFitsCrossing(crossing, plan);
          if (mismatch) {
            exclusions.push({ id: crossing.internalId, reason: mismatch });
            plan = null;
          }
        }
        if (!scopeAllows(scopes, crossing)) {
          plan = null;
          exclusions.push({ id: crossing.internalId, reason: "scope_inactive" });
        }
        const runtime = toRuntimeCrossing(crossing, plan, freshnessNow, hit.atM);
        if (runtime) located.push(runtime);
      }
      const covering = bundle.surveys.find((s) => surveyCoversRoute(s, route));
      const completeCoverage = covering?.complete === true;
      const crossings = completeCoverage
        ? located.filter((c) => covering!.crossingInternalIds.includes(c.id))
        : located.map((c) => ({ ...c, plan: null }));
      return {
        completeCoverage,
        crossings,
        source: covering ? `verified-survey:${covering.id}` : "verified-unsurveyed",
        exclusions,
      };
    },
  };
}
