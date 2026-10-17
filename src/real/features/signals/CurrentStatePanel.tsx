import { useEffect, useState } from "react";
import {
  isCurrentSignalView,
  remainingRawDisplay,
} from "../../api-contract.ts";

export function CurrentStatePanel({ payload }: { payload: unknown }) {
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const current = isCurrentSignalView(rec?.current) ? rec.current : null;
  const observation = rec?.observation && typeof rec.observation === "object"
    ? rec.observation as { source?: string; fresh?: boolean; synchronized?: boolean } : null;
  if (!current)
    return (
      <p className="muted">현재 상태 해석 결과가 없습니다. 원문을 확인하세요.</p>
    );
  const sourceAgeMs = current.sourceAgeMs == null ? null
    : current.sourceAgeMs + Math.max(0, nowMs - current.fetchedAtMs);
  const expired = sourceAgeMs === null || sourceAgeMs > 10_000 || sourceAgeMs < -1000;
  const age =
    sourceAgeMs == null
      ? "원천 시각 없음"
      : `${Math.round(sourceAgeMs / 1000)}초 전 원천`;
  return (
    <article>
      <h2>현재 보행신호 (예측 아님)</h2>
      <p>교차로 ID: {current.itstId ?? "없음"}</p>
      {observation && <p>{observation.source === "current-phase+timing" ? "실시간 신호·잔여시간 결합" : "통합 실시간 응답"} ·
        {expired ? " 현재 관측 만료 · 새로 조회하세요" : observation.fresh && observation.synchronized
          ? " 동시각 관측 수신" : " 동시각 관측 미확인"}</p>}
      <p>
        {current.stale || expired ? "지연된 응답 · " : ""}
        {current.missingSourceTime ? "원천 시각 없음 · " : ""}
        {age}
      </p>
      {current.pedestrian.length ? (
        <ul>
          {current.pedestrian.map((row) => (
            <li key={row.key}>
              {row.direction} · {row.key}: {row.statusName}
            </li>
          ))}
        </ul>
      ) : (
        <p>보행신호 상태명이 비어 있습니다.</p>
      )}
      <h3>잔여값</h3>
      {current.remainingPedestrian.length ? (
        <ul>
          {current.remainingPedestrian.map((row) => (
            <li key={row.key}>
              {row.direction} · {row.key}: {remainingRawDisplay(row.raw)}
            </li>
          ))}
        </ul>
      ) : (
        <p>이 응답에는 보행 잔여 필드가 없습니다. 현시(phase)와 잔여(timing)는 다른 서비스입니다.</p>
      )}
      <ul>
        {current.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </article>
  );
}
