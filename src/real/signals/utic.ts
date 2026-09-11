import { validCoord, type Coord } from "../core.ts";
import type { OperationMode } from "./schema.ts";
import {
  isUticRegion,
  reserveOperationMode,
  UTIC_WEEKDAY,
} from "./utic-codes.ts";

/** Official sample URLs in the HWP use http and mark SSL as unused. */
export const UTIC_HUB_LISTED = "http://tsihub.utic.go.kr/tsi/api";
export const UTIC_HUB = "https://tsihub.utic.go.kr/tsi/api";

export type UticOpId =
  | "crossInfo"
  | "crossDetailInfo"
  | "getPlanCRHDInfo"
  | "getPlanCRWDInfo"
  | "getPlanCRRSInfo"
  | "getPlanCROPInfo"
  | "getSigMapCRInfo";

export type UticOp = {
  id: UticOpId;
  kind: "file" | "query";
  path: string;
  requestFields: string[];
};

export const UTIC_OPS: Record<UticOpId, UticOp> = {
  crossInfo: {
    id: "crossInfo",
    kind: "file",
    path: "CrossRoadInfoService/download/crossInfo",
    requestFields: ["serviceKey", "srchCTId"],
  },
  crossDetailInfo: {
    id: "crossDetailInfo",
    kind: "file",
    path: "CrossRoadInfoService/download/crossDetailInfo",
    requestFields: ["serviceKey", "srchCTId"],
  },
  getPlanCRHDInfo: {
    id: "getPlanCRHDInfo",
    kind: "query",
    path: "PlanCrossRoadInfoService/getPlanCRHDInfo",
    requestFields: ["serviceKey", "type", "numOfRows", "pageNo", "srchCTId", "srchCRNm"],
  },
  getPlanCRWDInfo: {
    id: "getPlanCRWDInfo",
    kind: "query",
    path: "PlanCrossRoadInfoService/getPlanCRWDInfo",
    requestFields: ["serviceKey", "type", "numOfRows", "pageNo", "srchCTId", "srchCRNm"],
  },
  getPlanCRRSInfo: {
    id: "getPlanCRRSInfo",
    kind: "query",
    path: "PlanCrossRoadInfoService/getPlanCRRSInfo",
    requestFields: ["serviceKey", "type", "numOfRows", "pageNo", "srchCTId", "srchCRNm"],
  },
  getPlanCROPInfo: {
    id: "getPlanCROPInfo",
    kind: "query",
    path: "PlanCrossRoadInfoService/getPlanCROPInfo",
    requestFields: ["serviceKey", "type", "numOfRows", "pageNo", "srchCTId", "srchCRNm"],
  },
  getSigMapCRInfo: {
    id: "getSigMapCRInfo",
    kind: "query",
    path: "SigMapCrossRoadInfoService/getSigMapCRInfo",
    requestFields: ["serviceKey", "type", "numOfRows", "pageNo", "srchCTId", "srchCRNm"],
  },
};

export function uticUrl(
  op: UticOpId,
  query: URLSearchParams,
  hub = UTIC_HUB,
): string {
  return `${hub}/${UTIC_OPS[op].path}?${query}`;
}

export function uticQuery(
  op: UticOpId,
  input: {
    serviceKey: string;
    srchCTId: string;
    srchCRNm?: string;
    type?: "json" | "xml";
    pageNo?: string;
    numOfRows?: string;
  },
): URLSearchParams {
  const region = input.srchCTId.trim().toUpperCase();
  if (!isUticRegion(region)) throw new Error("unknown_utic_region");
  const fields = new Set(UTIC_OPS[op].requestFields);
  const q = new URLSearchParams({
    serviceKey: input.serviceKey,
    srchCTId: region,
  });
  if (fields.has("type")) q.set("type", input.type ?? "json");
  if (fields.has("srchCRNm") && input.srchCRNm?.trim())
    q.set("srchCRNm", input.srchCRNm.trim());
  if (fields.has("pageNo")) q.set("pageNo", input.pageNo ?? "1");
  if (fields.has("numOfRows")) q.set("numOfRows", input.numOfRows ?? "10");
  return q;
}

function num(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = row[key];
    if (v === "" || v == null) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function str(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = row[key];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function padHm(hour: number, minute: number): string | null {
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  )
    return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Spec sample lists unused phases as 0. Missing keys stay null — they are not 0.
 */
export function ringPhases(
  row: Record<string, unknown>,
  prefix: "A" | "B",
): (number | null)[] {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    num(row, `${prefix}_RING_${i}_PHASE_VAL`),
  );
}

function listedPhaseSum(phases: (number | null)[]): {
  sum: number;
  incomplete: boolean;
} {
  let sum = 0;
  let incomplete = false;
  for (const n of phases) {
    if (n === null) incomplete = true;
    else sum += n;
  }
  return { sum, incomplete };
}

export function cycleFromCrop(row: Record<string, unknown>): {
  cycleSec: number | null;
  aPhaseSec: (number | null)[];
  bPhaseSec: (number | null)[];
  reasons: string[];
} {
  const reasons: string[] = [];
  const listed = num(row, "INT_OPER_CYCLE_VAL");
  const aPhaseSec = ringPhases(row, "A");
  const bPhaseSec = ringPhases(row, "B");
  const a = listedPhaseSum(aPhaseSec);
  const b = listedPhaseSum(bPhaseSec);
  if (listed === null || listed < 20 || listed > 240) {
    reasons.push("cycle_out_of_range");
    return { cycleSec: null, aPhaseSec, bPhaseSec, reasons };
  }
  if (a.incomplete && aPhaseSec.some((n) => n !== null))
    reasons.push("a_ring_phases_incomplete");
  if (b.incomplete && bPhaseSec.some((n) => n !== null))
    reasons.push("b_ring_phases_incomplete");
  if (!a.incomplete && a.sum > 0 && a.sum !== listed)
    reasons.push("a_ring_sum_ne_cycle");
  if (!b.incomplete && b.sum > 0 && b.sum !== listed)
    reasons.push("b_ring_sum_ne_cycle");
  return { cycleSec: listed, aPhaseSec, bPhaseSec, reasons };
}

export type UticCropPlan = {
  regionCd: string;
  intNo: string;
  intNm: string;
  planNo: string;
  planIdx: string;
  startHm: string | null;
  cycleSec: number | null;
  offsetVal: number | null;
  aPhaseSec: (number | null)[];
  bPhaseSec: (number | null)[];
  collectedAt: string | null;
  engineReady: false;
  blockedReasons: string[];
};

export function parseCropRow(row: Record<string, unknown>): UticCropPlan | null {
  const regionCd = str(row, "REGION_CD")?.toUpperCase();
  const intNo = str(row, "INT_NO");
  if (!regionCd || !intNo || !isUticRegion(regionCd)) return null;
  const rings = cycleFromCrop(row);
  const startHm = padHm(
    num(row, "OPER_PLAN_HH") ?? -1,
    num(row, "OPER_PLAN_MI") ?? -1,
  );
  const blockedReasons = [
    "epoch_not_in_spec",
    "pedestrian_phase_unmapped",
    "current_plan_unconfirmed",
    ...rings.reasons,
  ];
  if (!startHm) blockedReasons.push("missing_oper_plan_clock");
  return {
    regionCd,
    intNo,
    intNm: str(row, "INT_NM") ?? "",
    planNo: str(row, "INT_PLAN_NO") ?? "",
    planIdx: str(row, "INT_PLAN_IDX_NO") ?? "",
    startHm,
    cycleSec: rings.cycleSec,
    offsetVal: num(row, "INT_OPER_OFFSET_VAL"),
    aPhaseSec: rings.aPhaseSec,
    bPhaseSec: rings.bPhaseSec,
    collectedAt: str(row, "COLLCT_DTIME"),
    engineReady: false,
    blockedReasons,
  };
}

export type UticWeekdayPlan = {
  regionCd: string;
  intNo: string;
  weekday: number;
  planNo: string;
};

export function parseWeekdayRow(row: Record<string, unknown>): UticWeekdayPlan | null {
  const regionCd = str(row, "REGION_CD")?.toUpperCase();
  const intNo = str(row, "INT_NO");
  const weekday = num(row, "PLAN_DY");
  const planNo = str(row, "INT_PLAN_NO");
  if (!regionCd || !intNo || !planNo || weekday === null) return null;
  if (!Object.hasOwn(UTIC_WEEKDAY, weekday)) return null;
  return { regionCd, intNo, weekday, planNo };
}

export type UticHolidayPlan = {
  regionCd: string;
  intNo: string;
  month: number;
  day: number;
  planNo: string;
};

export function parseHolidayRow(row: Record<string, unknown>): UticHolidayPlan | null {
  const regionCd = str(row, "REGION_CD")?.toUpperCase();
  const intNo = str(row, "INT_NO");
  const month = num(row, "HOLYDD_PLAN_MM", "HOLY_PLAN_MM");
  const day = num(row, "HOLYDD_PLAN_DD", "HOLY_PLAN_DD");
  const planNo = str(row, "INT_PLAN_NO");
  if (!regionCd || !intNo || !planNo || month === null || day === null) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { regionCd, intNo, month, day, planNo };
}

export type UticReservePlan = {
  regionCd: string;
  intNo: string;
  month: number | null;
  day: number | null;
  weekday: number | null;
  startHm: string | null;
  endHm: string | null;
  operationMode: OperationMode;
  controlCode: number | null;
  label: string | null;
};

export function parseReserveRow(row: Record<string, unknown>): UticReservePlan | null {
  const regionCd = str(row, "REGION_CD")?.toUpperCase();
  const intNo = str(row, "INT_NO");
  if (!regionCd || !intNo) return null;
  const mode = reserveOperationMode(num(row, "RESRV_CONTRL_CD"));
  return {
    regionCd,
    intNo,
    month: num(row, "RESRV_MM"),
    day: num(row, "RESRV_DD"),
    weekday: num(row, "RESRV_DY"),
    startHm: padHm(num(row, "RESRV_STRT_HH") ?? -1, num(row, "RESRV_STRT_MI") ?? -1),
    endHm: padHm(num(row, "RESRV_END_HH") ?? -1, num(row, "RESRV_END_MI") ?? -1),
    operationMode: mode.operationMode,
    controlCode: mode.code,
    label: mode.label,
  };
}

export type UticSigMapRow = {
  regionCd: string;
  intNo: string;
  ringNo: number | null;
  planTp: number | null;
  stepNo: number | null;
  car: (number | null)[];
  ped: (number | null)[];
  minTm: number | null;
  maxTm: number | null;
  eop: number | null;
};

export function parseSigMapRow(row: Record<string, unknown>): UticSigMapRow | null {
  const regionCd = str(row, "REGION_CD")?.toUpperCase();
  const intNo = str(row, "INT_NO");
  if (!regionCd || !intNo) return null;
  return {
    regionCd,
    intNo,
    ringNo: num(row, "RING_NO"),
    planTp: num(row, "PLAN_TP"),
    stepNo: num(row, "STEP_NO"),
    car: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => num(row, `CAR${i}`)),
    ped: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => num(row, `PED${i}`)),
    minTm: num(row, "MIN_TM"),
    maxTm: num(row, "MAX_TM"),
    eop: num(row, "EOP"),
  };
}

/**
 * CrossInfo XY has no CRS in the HWP. Range-looking numbers are not WGS84.
 * Pass `crs` only when a source document names it; otherwise keep raw XY.
 */
export function parseCrossInfoCoord(
  row: Record<string, unknown>,
  crs?: string,
): {
  raw: { x: number; y: number } | null;
  coord: Coord | null;
  crs: string;
  reason: string | null;
} {
  const x = num(row, "X", "POS_X", "LON", "x");
  const y = num(row, "Y", "POS_Y", "LAT", "y");
  if (x === null || y === null)
    return { raw: null, coord: null, crs: crs?.trim() || "unspecified", reason: "missing_xy" };
  const raw = { x, y };
  const listed = crs?.trim();
  if (!listed)
    return { raw, coord: null, crs: "unspecified", reason: "crs_unspecified" };
  const code = listed.toUpperCase().replace(" ", "");
  if (code === "EPSG:4326" || code === "WGS84") {
    const coord: Coord = [x, y];
    return validCoord(coord)
      ? { raw, coord, crs: listed, reason: null }
      : { raw, coord: null, crs: listed, reason: "wgs84_out_of_range" };
  }
  return {
    raw,
    coord: null,
    crs: listed,
    reason: "crs_not_in_crossinfo_spec",
  };
}

export type UticBundle = {
  weekday: UticWeekdayPlan[];
  holiday: UticHolidayPlan[];
  reserve: UticReservePlan[];
  crop: UticCropPlan[];
};

function seoulParts(atMs: number): { weekday: number; month: number; day: number; hm: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(atMs)).map((p) => [p.type, p.value]),
  );
  const weekdayName: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const hm = `${parts.hour}:${parts.minute}`;
  return {
    weekday: weekdayName[parts.weekday] ?? 0,
    month: Number(parts.month),
    day: Number(parts.day),
    hm,
    minutes: hmToMin(hm),
  };
}

function inHmRange(now: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const n = hmToMin(now);
  const a = hmToMin(start);
  const b = hmToMin(end);
  if (a === b) return n === a;
  if (a < b) return n >= a && n < b;
  return n >= a || n < b;
}

export type UticSelection = {
  regionCd: string;
  intNo: string;
  planNo: string | null;
  source: "holiday" | "weekday" | "none";
  reserve: UticReservePlan | null;
  crop: UticCropPlan | null;
  operationMode: OperationMode;
  engineReady: false;
  blockedReasons: string[];
};

/**
 * Spec relationships: holiday date → INT_PLAN_NO, else weekday → INT_PLAN_NO,
 * then latest CROP OPER_PLAN clock ≤ now. Reservation overlays mode.
 * Offset is stored, never turned into epochMs.
 */
export function selectUticPlan(
  bundle: UticBundle,
  regionCd: string,
  intNo: string,
  atMs: number,
): UticSelection {
  const region = regionCd.trim().toUpperCase();
  const clock = seoulParts(atMs);
  const holiday = bundle.holiday.find(
    (h) =>
      h.regionCd === region &&
      h.intNo === intNo &&
      h.month === clock.month &&
      h.day === clock.day,
  );
  const weekday = bundle.weekday.find(
    (w) => w.regionCd === region && w.intNo === intNo && w.weekday === clock.weekday,
  );
  const source = holiday ? "holiday" : weekday ? "weekday" : "none";
  const planNo = holiday?.planNo ?? weekday?.planNo ?? null;
  const reserve =
    bundle.reserve.find((r) => {
      if (r.regionCd !== region || r.intNo !== intNo) return false;
      if (r.month && r.day && (r.month !== clock.month || r.day !== clock.day))
        return false;
      if (r.weekday && r.weekday !== clock.weekday) return false;
      return inHmRange(clock.hm, r.startHm, r.endHm);
    }) ?? null;
  const candidates = bundle.crop.filter(
    (c) =>
      c.regionCd === region &&
      c.intNo === intNo &&
      (planNo === null || c.planNo === planNo) &&
      c.startHm,
  );
  const crop =
    candidates
      .filter((c) => hmToMin(c.startHm!) <= clock.minutes)
      .sort((a, b) => hmToMin(b.startHm!) - hmToMin(a.startHm!))[0] ??
    null;
  const blockedReasons = [
    ...(crop?.blockedReasons ?? ["no_crop_for_clock"]),
    ...(planNo ? [] : ["no_weekday_or_holiday_plan"]),
    ...(reserve && reserve.operationMode !== "fixed"
      ? [`reserve_${reserve.operationMode}`]
      : []),
  ];
  return {
    regionCd: region,
    intNo,
    planNo,
    source,
    reserve,
    crop,
    operationMode: reserve?.operationMode ?? "unknown",
    engineReady: false,
    blockedReasons,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectNamed(body: unknown, names: string[]): Record<string, unknown>[] {
  if (Array.isArray(body))
    return body.map(asRecord).filter((r): r is Record<string, unknown> => !!r);
  const rec = asRecord(body);
  if (!rec) return [];
  for (const name of names) {
    if (!(name in rec)) continue;
    const inner = rec[name];
    if (Array.isArray(inner))
      return inner.map(asRecord).filter((r): r is Record<string, unknown> => !!r);
    const one = asRecord(inner);
    return one ? [one] : [];
  }
  const wrapped = asRecord(rec.PlanCrossRoadInfoService) ?? asRecord(rec.SigMapCrossRoadInfoService);
  if (wrapped) return collectNamed(wrapped, names);
  if ("INT_NO" in rec || "REGION_CD" in rec) return [rec];
  return [];
}

export function parseUticBody(kind: "crop" | "weekday" | "holiday" | "reserve" | "sigmap", body: unknown) {
  const names =
    kind === "crop"
      ? ["PlanCROPInfo"]
      : kind === "weekday"
        ? ["PlanCRWDInfo"]
        : kind === "holiday"
          ? ["PlanCRHDInfo"]
          : kind === "reserve"
            ? ["PlanCRRSInfo"]
            : ["SigMapCRInfo"];
  const rows = collectNamed(body, names);
  if (kind === "crop") return rows.map(parseCropRow).filter(Boolean);
  if (kind === "weekday") return rows.map(parseWeekdayRow).filter(Boolean);
  if (kind === "holiday") return rows.map(parseHolidayRow).filter(Boolean);
  if (kind === "reserve") return rows.map(parseReserveRow).filter(Boolean);
  return rows.map(parseSigMapRow).filter(Boolean);
}
