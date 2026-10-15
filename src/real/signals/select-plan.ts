import type { OperatingPlanRecord } from "./schema.ts";

function seoulWeekdayAndHm(atMs: number): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    weekday: "short",
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
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return { weekday: weekdayName[parts.weekday] ?? 0, minutes };
}

function hmToMin(hm: string): number {
  if (hm === "24:00") return 24 * 60;
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/** Inclusive start, exclusive end. Wrap past midnight. 24:00 is end-of-day. */
export function inPlanTimeBand(nowMin: number, startHm: string, endHm: string): boolean {
  const a = hmToMin(startHm);
  const b = hmToMin(endHm);
  if (a === b) return nowMin === a;
  if (a < b) return nowMin >= a && nowMin < b;
  return nowMin >= a || nowMin < b;
}

/**
 * Pick the operating plan that matches this crossing's IDs, clock, weekday,
 * and special-day list. Empty weekdays = all regular days.
 * Plans with specialDayIds only apply on those ids. Unlisted special days
 * never fall through (appliesOnUnlistedSpecialDay is always false).
 */
export function planAppliesAt(
  plan: OperatingPlanRecord,
  atMs: number,
  specialDayId: string | null = null,
): boolean {
  if (atMs < plan.validFromMs || atMs > plan.validToMs) return false;
  const specials = plan.apply.specialDayIds;
  if (specialDayId) {
    if (!specials.includes(specialDayId)) return false;
  } else if (specials.length) {
    return false;
  }
  const clock = seoulWeekdayAndHm(atMs);
  if (plan.apply.weekdays.length && !plan.apply.weekdays.includes(clock.weekday))
    return false;
  return inPlanTimeBand(clock.minutes, plan.apply.startHm, plan.apply.endHm);
}

export function selectOperatingPlan(
  plans: OperatingPlanRecord[],
  match: {
    source: string;
    sourceIntersectionId: string;
    pedestrianSignalGroupId: string;
  },
  atMs: number,
  specialDayId: string | null = null,
): { plan: OperatingPlanRecord | null; reason: string | null } {
  const candidates = plans.filter(
    (p) =>
      p.source === match.source &&
      p.sourceIntersectionId === match.sourceIntersectionId &&
      p.pedestrianSignalGroupId === match.pedestrianSignalGroupId,
  );
  if (!candidates.length) return { plan: null, reason: "no_plan_for_crossing_ids" };
  const applicable = candidates.filter((p) => planAppliesAt(p, atMs, specialDayId));
  if (!applicable.length) return { plan: null, reason: "no_plan_for_clock" };
  applicable.sort((a, b) => b.validFromMs - a.validFromMs);
  return { plan: applicable[0], reason: null };
}
