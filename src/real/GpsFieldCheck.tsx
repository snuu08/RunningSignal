import { useEffect, useRef, useState } from "react";
import { paceLabel, rollingPace, timeLabel } from "./core.ts";
import { useGpsRun } from "./useGpsRun.ts";
import { downloadJson, readState, saveState } from "./storage.ts";
import {
  GPS_FIELD_EVENT_LIMIT, GPS_FIELD_SCHEMA, summarizeGpsField, type GpsFieldReport,
} from "./gps-field.ts";

export function GpsFieldCheck({ owner, onBack }: { owner: string; onBack: () => void }) {
  const storageKey = `gps-field:${owner}`;
  const [mode, setMode] = useState<GpsFieldReport["mode"]>("stationary");
  const [reference, setReference] = useState("1000");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<GpsFieldReport | null>(null);
  const report = useRef<GpsFieldReport | null>(null);
  const savedAt = useRef(0);
  const run = useGpsRun((live) => {
    if (!report.current) return;
    report.current.run = live;
    setSnapshot({ ...report.current, events: [...report.current.events], run: live });
    if (live.phase !== "running" || Date.now() - savedAt.current >= 5000 || document.hidden) {
      savedAt.current = Date.now();
      void saveState(storageKey, report.current).catch(() => setError("검사 결과를 기기에 저장하지 못했습니다. JSON을 내보내 주세요."));
    }
  }, (event) => {
    const current = report.current;
    if (!current) return;
    if (current.events.length < GPS_FIELD_EVENT_LIMIT) current.events.push(event);
    else current.droppedEvents++;
  });
  const recover = useRef(run.recover);
  useEffect(() => {
    let active = true;
    void readState<GpsFieldReport>(storageKey).then((stored) => {
      if (!active) return;
      if (stored?.schema === GPS_FIELD_SCHEMA && Array.isArray(stored.events)) {
        report.current = stored;
        setSnapshot(stored);
        setMode(stored.mode);
        setReference(String(stored.referenceM || 1000));
        // Reopened measurements stay paused. Closed-app time is not measured.
        if (stored.run && stored.run.phase !== "ended") recover.current(stored.run);
      }
      setReady(true);
    }).catch(() => {
      if (active) { setError("이전 검사 결과를 읽지 못했습니다."); setReady(true); }
    });
    return () => { active = false; };
  }, [storageKey]);
  const live = run.live ?? snapshot?.run ?? null;
  const current = snapshot ? { ...snapshot, run: live } : null;
  const summary = current ? summarizeGpsField(current) : null;
  const ongoing = live && live.phase !== "ended";
  const start = async () => {
    const referenceM = Number(reference);
    if (mode === "distance" && (!Number.isFinite(referenceM) || referenceM < 100 || referenceM > 50_000)) {
      setError("기준 거리는 100~50,000m로 입력해 주세요."); return;
    }
    setBusy(true); setError("");
    run.clear();
    report.current = {
      schema: GPS_FIELD_SCHEMA, source: "browser-geolocation", mode,
      referenceM: mode === "distance" ? referenceM : 0,
      userAgent: navigator.userAgent, events: [], droppedEvents: 0, run: null,
    };
    setSnapshot(null);
    try { await run.start(null); }
    catch (e) { setError(e instanceof Error ? e.message : "GPS 검사를 시작하지 못했습니다."); }
    finally {
      setBusy(false);
      if (report.current) setSnapshot({ ...report.current, events: [...report.current.events] });
    }
  };
  const finish = () => {
    const ended = run.end();
    if (report.current && ended) report.current.run = ended;
    if (report.current) setSnapshot({ ...report.current, events: [...report.current.events] });
  };
  const exportReport = () => {
    if (!current || !live) return;
    downloadJson(`flowrun-gps-field-${live.startedAt}.json`, {
      ...current, summary: summarizeGpsField(current),
      measurementClaim: "Recorded by this browser. Physical outdoor conditions require review.",
    });
  };
  return <section>
    <p className="eyebrow">GPS FIELD CHECK</p><h1>야외 GPS 검사</h1>
    <p>실제 휴대폰에서 측정하세요. 위치와 수신 오류는 이 기기에만 저장됩니다. JSON에는 정확한 위치가 포함됩니다.</p>
    <article>
      <label>검사 종류<select disabled={!!ongoing || busy} value={mode} onChange={(e) => setMode(e.target.value as GpsFieldReport["mode"])}>
        <option value="stationary">제자리 2분 · 거리 흔들림</option>
        <option value="distance">알려진 거리 달리기 · 거리·페이스</option>
      </select></label>
      {mode === "distance" && <label>기준 거리 (m)<input type="number" min="100" max="50000" disabled={!!ongoing || busy} value={reference} onChange={(e) => setReference(e.target.value)} /></label>}
      <p className="muted">{mode === "stationary" ? "같은 자리에 2분 이상 머문 뒤 검사를 종료하세요. 잠정 비교 기준: 누적 거리 10m 이하." : "거리가 확인된 구간을 달린 뒤 종료하세요. 잠정 비교 기준: 기준 거리 대비 ±5% 이내."}</p>
      {!ongoing && <button className="primary" disabled={busy || !ready} onClick={() => void start()}>{busy ? "GPS 확인 중…" : "새 검사 시작"}</button>}
      {ongoing && <div className="button-row">
        <button onClick={() => live.phase === "running" ? run.pause() : run.resume()}>{live.phase === "running" ? "검사 일시정지" : "검사 계속하기"}</button>
        <button onClick={finish}>검사 종료·저장</button>
      </div>}
      {(error || run.error) && <p role="alert">{error || run.error}</p>}
    </article>
    {summary && <article aria-label="GPS 검사 결과">
      <h2>측정 결과</h2>
      <p>상태: {live?.phase === "ended" ? "종료" : live?.phase === "paused" ? "일시정지" : live ? "측정 중" : "시작 전"}</p>
      <p>운동시간 {timeLabel(summary.activeSec)} · 거리 {summary.distanceM.toFixed(1)}m</p>
      <p>최근 페이스 {paceLabel(live ? rollingPace(live.track, live.lastTick, 30) : null)}/km</p>
      <p>수신 {summary.sampleCount}개 · 반영 {summary.acceptedCount}개 · 제외 {summary.rejectedCount}개</p>
      <p>GPS 공백 {summary.gapSec.toFixed(1)}초 · 화면 이탈 {summary.hiddenCount}회</p>
      {summary.unobservedTailSec > 0 && <p>마지막 위치 이후 미수신 {summary.unobservedTailSec.toFixed(1)}초</p>}
      <p>오차 범위 95백분위: {summary.accuracyP95M === null ? "미수신" : `${summary.accuracyP95M.toFixed(1)}m`}</p>
      {summary.errorPercent !== null && <p>기준 거리 대비 {summary.errorPercent.toFixed(1)}%</p>}
      <p>{summary.verdict === "insufficient" ? "판정 대기 · 측정량 또는 종료 조건 부족" : summary.verdict === "within-trial-limit" ? "잠정 기준 이내 · 현장 조건과 원본 확인 필요" : "확인 필요 · 거리 오차·GPS 공백 또는 기록 한도 초과"}</p>
      <button disabled={!live} onClick={exportReport}>GPS 검사 JSON 내보내기</button>
    </article>}
    <p className="muted">화면 잠금으로 GPS가 끊길 수 있습니다. 복귀 시 위치를 다시 구독하며 수신 공백을 거리로 보간하지 않습니다. 자동 테스트 통과와 야외 실측은 별도로 확인합니다.</p>
    <button disabled={!!ongoing || busy} onClick={onBack}>개발 연결 확인으로</button>
  </section>;
}
