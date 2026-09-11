import type { FieldObservation } from "./schema.ts";

export type MaeSlice = {
  n: number;
  mae: number | null;
  medianAe: number | null;
  p90Ae: number | null;
};

export type MaeReport = {
  syntheticIncluded: false;
  accuracyClaim: "unverified";
  wait: MaeSlice;
  transition: MaeSlice;
  unpredictable: number;
  exceptions: number;
  byIntersection: Record<string, MaeSlice>;
  byTimeBand: Record<string, MaeSlice>;
  byDirectionKey: Record<string, MaeSlice>;
  notes: string[];
};

function absErr(a: number, b: number): number {
  return Math.abs(a - b);
}

function sliceOf(errors: number[]): MaeSlice {
  if (!errors.length) return { n: 0, mae: null, medianAe: null, p90Ae: null };
  const sorted = [...errors].sort((x, y) => x - y);
  const mae = errors.reduce((s, n) => s + n, 0) / errors.length;
  const mid = Math.floor(sorted.length / 2);
  const medianAe =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p90Ae = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
  return { n: errors.length, mae, medianAe, p90Ae };
}

function groupSlice(
  rows: { key: string; err: number }[],
): Record<string, MaeSlice> {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const list = map.get(row.key) ?? [];
    list.push(row.err);
    map.set(row.key, list);
  }
  return Object.fromEntries([...map.entries()].map(([k, v]) => [k, sliceOf(v)]));
}

/**
 * Compare field observations to stored predictions.
 * Null prediction/observation is unpredictable, never coerced to 0.
 * Synthetic rows are counted out of the accuracy tables.
 */
export function evaluateObservations(rows: FieldObservation[]): MaeReport {
  const field = rows.filter((r) => !r.synthetic);
  const waitErr: number[] = [];
  const transErr: number[] = [];
  const waitByIx: { key: string; err: number }[] = [];
  const waitByBand: { key: string; err: number }[] = [];
  const waitByDir: { key: string; err: number }[] = [];
  let unpredictable = 0;
  let exceptions = 0;
  for (const row of field) {
    if (row.exceptionOperation) {
      exceptions += 1;
      continue;
    }
    if (row.predictedWaitSec === null || row.observedWaitSec === null) {
      unpredictable += 1;
    } else {
      const err = absErr(row.predictedWaitSec, row.observedWaitSec);
      waitErr.push(err);
      waitByIx.push({ key: row.sourceIntersectionId, err });
      waitByBand.push({ key: row.timeBand || "unspecified", err });
      waitByDir.push({ key: row.crossingInternalId, err });
    }
    if (row.greenStartMs !== null && row.arrivedEntryMs !== null && row.predictedWaitSec !== null) {
      const predictedGreen = row.arrivedEntryMs + row.predictedWaitSec * 1000;
      transErr.push(absErr(predictedGreen, row.greenStartMs) / 1000);
    }
  }
  return {
    syntheticIncluded: false,
    accuracyClaim: "unverified",
    wait: sliceOf(waitErr),
    transition: sliceOf(transErr),
    unpredictable,
    exceptions,
    byIntersection: groupSlice(waitByIx),
    byTimeBand: groupSlice(waitByBand),
    byDirectionKey: groupSlice(waitByDir),
    notes: [
      "평가 도구 구현 완료 / 실제 정확도 미검증",
      "합성 관측은 집계에서 제외한다",
      "예측 실패·미확인은 0초로 넣지 않고 unpredictable로 센다",
      "같은 관측으로 모델을 맞추고 그대로 검증하지 말 것",
    ],
  };
}

export function predictableRate(report: MaeReport, fieldN: number): number | null {
  if (!(fieldN > 0)) return null;
  return report.wait.n / fieldN;
}
