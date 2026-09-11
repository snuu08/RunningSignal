export const APP_NAME = "FLOW RUN";
export const APP_VERSION = "0.0.0";

export const STORAGE_PREFIX = "flowrun:";
export const STORAGE_SCHEMA_VERSION = 1;
export const SETTINGS_SCHEMA_VERSION = 1;

export const WAIT_DETOUR_THRESHOLD_SEC = 15;
/** Extra-wait gap treated as a tie; then shorter extra distance and fewer turns win. Tunable. */
export const WAIT_DIFF_NEGLIGIBLE_SEC = 10;
/** Extra meters one avoided stop is worth when balancing distance vs stops. */
export const BALANCED_STOP_VALUE_M = 120;
/** Extra meters one saved wait-second is worth in the balanced style. */
export const BALANCED_WAIT_VALUE_M_PER_SEC = 4;

/**
 * Trial detour presets shared by demo engine and real TMAP ranking.
 * Not a field-validated product optimum. Real mode must use the same
 * ratio+maxM pair (5%→150m, 10%→300m, 15%→500m) on server and screen.
 */
export const DETOUR_PRESETS = {
  tight: { ratio: 0.05, maxM: 150 },
  normal: { ratio: 0.1, maxM: 300 },
  generous: { ratio: 0.15, maxM: 500 },
} as const;

export const INITIAL_DETOUR_RATIO = DETOUR_PRESETS.normal.ratio;
export const INITIAL_DETOUR_MAX_M = DETOUR_PRESETS.normal.maxM;

/** Demo engine only when the runner skipped a goal pace. Not a stored user record. */
export const DEMO_OPEN_PACE_SECONDS = 360;

export const MIN_ROUTE_LOADING_MS = 1000;
export const SPLASH_FIRST_MS = 1800;
export const SPLASH_RETURN_MS = 400;

export const PBKDF2_ITERATIONS = 100_000;
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export const SEARCH_EXPAND_LIMIT = 4000;
export const SEARCH_PATH_LIMIT = 12;
export const SEARCH_TIME_BUDGET_MS = 80;

/**
 * Extra seconds added after painted-crossing walk time.
 * Product assumption, not a field-validated clearance margin.
 */
export const CROSSING_BUFFER_SEC = 3;
/**
 * Pedestrian crossing walk speed used to estimate time on the painted crossing.
 * Not the runner's pace. 1.2 m/s is a product trial default (common pedestrian
 * design speed), not a measured Seoul clearance model and not a safety claim.
 * Keep this file as the only source for the number.
 */
export const CROSSING_WALK_M_PER_SEC = 1.2;
export const SHARP_TURN_DEG = 50;
export const GENTLE_TURN_DEG = 22;
export const ZIGZAG_WINDOW_M = 90;

export const SIM_SPEEDS = [1, 10, 30] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];
