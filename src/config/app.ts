export const APP_NAME = "FLOW RUN";

export const STORAGE_PREFIX = "flowrun:";
export const STORAGE_SCHEMA_VERSION = 1;

export const WAIT_DETOUR_THRESHOLD_SEC = 15;
/** Initial demo detour cap versus the baseline path. Tunable, not a user-confirmed product value. */
export const INITIAL_DETOUR_RATIO = 0.1;

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

export const CROSSING_BUFFER_SEC = 3;
export const SHARP_TURN_DEG = 50;
export const GENTLE_TURN_DEG = 22;
export const ZIGZAG_WINDOW_M = 90;

export const SIM_SPEEDS = [1, 10, 30] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];
