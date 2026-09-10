import {
  DETOUR_PRESETS,
  INITIAL_DETOUR_MAX_M,
  INITIAL_DETOUR_RATIO,
  WAIT_DETOUR_THRESHOLD_SEC,
} from "../config/app.ts";

/**
 * Shared real-mode routing limits for server and screen.
 *
 * Numbers come from DETOUR_PRESETS / WAIT_DETOUR_THRESHOLD_SEC.
 * They are **trial defaults for beta comparison**, not a confirmed
 * product optimum or a field-validated signal policy.
 */
export type RealRoutingPolicy = {
  detourRatio: number;
  detourMaxM: number;
  avoidStairs: boolean;
  avoidOverpass: boolean;
  avoidAlley: boolean;
  extraSharpTurns: number;
  waitThresholdSec: number;
};

export const TRIAL_ROUTING_POLICY: RealRoutingPolicy = {
  detourRatio: INITIAL_DETOUR_RATIO,
  detourMaxM: INITIAL_DETOUR_MAX_M,
  avoidStairs: false,
  avoidOverpass: false,
  avoidAlley: false,
  extraSharpTurns: 2,
  waitThresholdSec: WAIT_DETOUR_THRESHOLD_SEC,
};

export function allowedExtraMeters(
  baselineM: number,
  policy: Pick<RealRoutingPolicy, "detourRatio" | "detourMaxM">,
): number {
  return Math.min(Math.max(0, baselineM) * policy.detourRatio, policy.detourMaxM);
}

export function detourMaxMForRatio(ratio: number): number {
  const hit = Object.values(DETOUR_PRESETS).find(
    (p) => Math.abs(p.ratio - ratio) < 1e-9,
  );
  return hit?.maxM ?? INITIAL_DETOUR_MAX_M;
}

export function policyFromProfile(profile: {
  detour: number;
  avoidStairs: boolean;
  avoidOverpass: boolean;
  avoidAlley: boolean;
}): RealRoutingPolicy {
  const detourRatio = Number.isFinite(profile.detour)
    ? profile.detour
    : TRIAL_ROUTING_POLICY.detourRatio;
  return {
    ...TRIAL_ROUTING_POLICY,
    detourRatio,
    detourMaxM: detourMaxMForRatio(detourRatio),
    avoidStairs: !!profile.avoidStairs,
    avoidOverpass: !!profile.avoidOverpass,
    avoidAlley: !!profile.avoidAlley,
  };
}

function finiteIn(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** Accept a client/server body. Missing fields fall back to trial defaults. */
export function parseRoutingPolicy(raw: unknown): RealRoutingPolicy {
  const src =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const detourRatio = finiteIn(
    src.detourRatio,
    0.01,
    0.3,
    TRIAL_ROUTING_POLICY.detourRatio,
  );
  return {
    detourRatio,
    detourMaxM: finiteIn(
      src.detourMaxM,
      50,
      2000,
      detourMaxMForRatio(detourRatio),
    ),
    avoidStairs: typeof src.avoidStairs === "boolean" ? src.avoidStairs : false,
    avoidOverpass:
      typeof src.avoidOverpass === "boolean" ? src.avoidOverpass : false,
    avoidAlley: typeof src.avoidAlley === "boolean" ? src.avoidAlley : false,
    extraSharpTurns: Math.round(
      finiteIn(src.extraSharpTurns, 0, 6, TRIAL_ROUTING_POLICY.extraSharpTurns),
    ),
    waitThresholdSec: Math.round(
      finiteIn(
        src.waitThresholdSec,
        1,
        120,
        TRIAL_ROUTING_POLICY.waitThresholdSec,
      ),
    ),
  };
}
