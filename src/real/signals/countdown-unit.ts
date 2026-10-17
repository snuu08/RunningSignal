/** Diagnostic evidence only. A unit estimate never verifies a physical crossing. */
export const SIGNAL_DIRECTIONS = ["nt", "et", "st", "wt", "ne", "se", "sw", "nw"] as const;
export type SignalDirection = typeof SIGNAL_DIRECTIONS[number];
export type CountdownSample = {
  itstId: string;
  sourceTimestampMs: number;
  fetchedAtMs: number;
  deviceId: string;
  states: Partial<Record<SignalDirection, { status: string; raw: number }>>;
};
export type UnitEstimate = {
  direction: SignalDirection;
  unit: "deciseconds" | "centiseconds" | null;
  pairs: number;
  observedSourceSec: number;
  unitsPerSecond: number | null;
  reason: "measured" | "insufficient" | "inconsistent";
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

export function countdownSample(payload: unknown, expectedId: string): CountdownSample | null {
  const p = record(payload), current = record(p?.current), observation = record(p?.observation);
  if (p?.resultClass !== "ok-data" || observation?.fresh !== true || observation.synchronized !== true ||
    current?.itstId !== expectedId || current.stale !== false || current.missingSourceTime !== false ||
    typeof current.sourceTimestampMs !== "number" || !Number.isFinite(current.sourceTimestampMs) ||
    typeof current.fetchedAtMs !== "number" || !Number.isFinite(current.fetchedAtMs)) return null;
  const age = current.fetchedAtMs - current.sourceTimestampMs;
  if (age < -1000 || age > 10_000) return null;
  const rows = Array.isArray(p.data) ? p.data.map(record).filter((r) => r &&
    String(r.itstId) === expectedId && Number(r.trsmUtcTime) === current.sourceTimestampMs) : [];
  if (rows.length !== 1 || typeof rows[0]?.eqmnId !== "string" || !rows[0].eqmnId.trim()) return null;
  const row = rows[0];
  const states: CountdownSample["states"] = {};
  for (const direction of SIGNAL_DIRECTIONS) {
    const status = row[`${direction}PdsgStatNm`], raw = row[`${direction}PdsgRmdrCs`];
    if (typeof status === "string" && status.trim() && typeof raw === "number" &&
      Number.isFinite(raw) && raw >= 0) states[direction] = { status: status.toLowerCase(), raw };
  }
  return Object.keys(states).length ? {
    itstId: expectedId, sourceTimestampMs: current.sourceTimestampMs,
    fetchedAtMs: current.fetchedAtMs, deviceId: row.eqmnId as string, states,
  } : null;
}

export function estimateCountdownUnit(samples: CountdownSample[], direction: SignalDirection): UnitEstimate {
  const rates: { rate: number; seconds: number }[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], x = a.states[direction], y = b.states[direction];
    // Do not bridge a state change, duplicate source packet, device or intersection.
    if (a.itstId !== b.itstId || a.deviceId !== b.deviceId || !x || !y || x.status !== y.status) continue;
    const seconds = (b.sourceTimestampMs - a.sourceTimestampMs) / 1000;
    if (seconds < 2 || seconds > 30) continue;
    const rate = (x.raw - y.raw) / seconds;
    rates.push({ rate, seconds });
  }
  const span = rates.reduce((sum, r) => sum + r.seconds, 0);
  const base = { direction, pairs: rates.length, observedSourceSec: span,
    unitsPerSecond: span ? rates.reduce((sum, r) => sum + r.rate * r.seconds, 0) / span : null };
  if (rates.length < 4 || span < 20) return { ...base, unit: null, reason: "insufficient" };
  // Every usable interval must agree; a frozen clock or reset is not a countdown.
  const unit = rates.every((r) => Math.abs(r.rate - 10) <= 1) ? "deciseconds"
    : rates.every((r) => Math.abs(r.rate - 100) <= 10) ? "centiseconds" : null;
  return { ...base, unit, reason: unit ? "measured" : "inconsistent" };
}
