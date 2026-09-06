import {
  BALANCED_STOP_VALUE_M,
  BALANCED_WAIT_VALUE_M_PER_SEC,
  DETOUR_PRESETS,
  SETTINGS_SCHEMA_VERSION,
  WAIT_DETOUR_THRESHOLD_SEC,
  WAIT_DIFF_NEGLIGIBLE_SEC,
} from "../config/app.ts";
import type {
  DetourAllowance,
  RecommendStyle,
  UserAppSettings,
} from "./models.ts";
import type { RoutingPolicyConfig } from "./routing-policy.ts";

export const DEFAULT_APP_SETTINGS: UserAppSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  recommendStyle: "balanced",
  detourAllowance: "normal",
  avoidStairs: true,
  avoidOverpass: true,
  showRouteSignals: true,
  showNearbySignals: false,
  voiceGuidance: false,
  vibrationGuidance: false,
  keepScreenOn: false,
};

export function defaultAppSettings(): UserAppSettings {
  return { ...DEFAULT_APP_SETTINGS };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeAppSettings(raw?: Partial<UserAppSettings> | null): UserAppSettings {
  const style: RecommendStyle = raw?.recommendStyle === "min-stops" ? "min-stops" : "balanced";
  const allowance: DetourAllowance =
    raw?.detourAllowance === "tight" || raw?.detourAllowance === "generous"
      ? raw.detourAllowance
      : "normal";
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    recommendStyle: style,
    detourAllowance: allowance,
    avoidStairs: asBoolean(raw?.avoidStairs, true),
    avoidOverpass: asBoolean(raw?.avoidOverpass, true),
    showRouteSignals: asBoolean(raw?.showRouteSignals, true),
    showNearbySignals: asBoolean(raw?.showNearbySignals, false),
    voiceGuidance: asBoolean(raw?.voiceGuidance, false),
    vibrationGuidance: asBoolean(raw?.vibrationGuidance, false),
    keepScreenOn: asBoolean(raw?.keepScreenOn, false),
  };
}

export function detourPreset(allowance: DetourAllowance): { ratio: number; maxM: number } {
  return DETOUR_PRESETS[allowance];
}

export function routingPolicyFromSettings(settings: UserAppSettings): RoutingPolicyConfig {
  const preset = detourPreset(settings.detourAllowance);
  return {
    detourRatio: preset.ratio,
    detourMaxM: preset.maxM,
    waitThresholdSec: WAIT_DETOUR_THRESHOLD_SEC,
    waitDiffNegligibleSec: WAIT_DIFF_NEGLIGIBLE_SEC,
    recommendStyle: settings.recommendStyle,
    avoidStairs: settings.avoidStairs,
    avoidOverpass: settings.avoidOverpass,
    balancedStopValueM: BALANCED_STOP_VALUE_M,
    balancedWaitValueMPerSec: BALANCED_WAIT_VALUE_M_PER_SEC,
  };
}

export function recommendStyleLabel(style: RecommendStyle): string {
  return style === "min-stops" ? "멈춤 최소" : "거리와 멈춤 균형";
}

export function detourAllowanceLabel(allowance: DetourAllowance): string {
  if (allowance === "tight") return "적게";
  if (allowance === "generous") return "넉넉하게";
  return "보통";
}

export function formatUsualPaceSummary(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) return "미등록";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}분 ${String(rest).padStart(2, "0")}초/km`;
}
