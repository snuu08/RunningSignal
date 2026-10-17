import { TDATA_CALLABLE, type TdataCallId } from "../src/real/signals/tdata.ts";

export type SeoulCredentials = string | Partial<Record<TdataCallId, string>>;
export const SEOUL_SERVICE_KEY_ENV: Record<TdataCallId, string> = {
  current: "SEOUL_TDATA_CURRENT_API_KEY",
  "phase-current": "SEOUL_TDATA_PHASE_CURRENT_API_KEY",
  "timing-current": "SEOUL_TDATA_TIMING_CURRENT_API_KEY",
  phase: "SEOUL_TDATA_PHASE_API_KEY",
  timing: "SEOUL_TDATA_TIMING_API_KEY",
  connection: "SEOUL_TDATA_CONNECTION_API_KEY",
  lane: "SEOUL_TDATA_LANE_API_KEY",
};

/** A dataset-specific key wins; the existing shared key remains compatible. */
export function seoulCredentialsFrom(env: Record<string, string | undefined>) {
  const shared = env.SEOUL_TDATA_API_KEY?.trim() ?? "";
  return Object.fromEntries((Object.keys(TDATA_CALLABLE) as TdataCallId[]).map((service) =>
    [service, env[SEOUL_SERVICE_KEY_ENV[service]]?.trim() || shared])) as Record<TdataCallId, string>;
}
export function seoulKeyFor(credentials: SeoulCredentials, service: TdataCallId): string {
  return (typeof credentials === "string" ? credentials : credentials[service])?.trim() ?? "";
}
export function seoulServiceConfiguration(credentials: SeoulCredentials) {
  return Object.fromEntries((Object.keys(TDATA_CALLABLE) as TdataCallId[]).map((service) =>
    [service, !!seoulKeyFor(credentials, service)])) as Record<TdataCallId, boolean>;
}
