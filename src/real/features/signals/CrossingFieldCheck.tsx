import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "../../backend.ts";
import { downloadJson, readState, saveState } from "../../storage.ts";
import { countdownSample, SIGNAL_DIRECTIONS, type SignalDirection } from "../../signals/countdown-unit.ts";
import { assessCrossingField, crossingCandidates, SEOUL_CROSSING_CATALOG,
  type CrossingFieldReport, type FieldLight } from "../../signals/crossing-field.ts";

const EMPTY = (itstId: string): CrossingFieldReport => ({ version: 1, itstId,
  managementId: "", direction: "nt", entry: null, exit: null, observations: [] });
const REASONS: Record<string, string> = {
  signalized_crossing_required: "보행등이 있는 실제 횡단보도 선택",
  entry_accurate_gps_required: "진입점 GPS 오차 10m 이내 기록",
  exit_accurate_gps_required: "도착점 GPS 오차 10m 이내 기록",
  entry_outside_candidate: "진입점과 공식 위치 대조", exit_outside_candidate: "도착점과 공식 위치 대조",
  crossing_length_invalid: "진입·도착점 거리 확인", more_observations_required: "관측 6개 이상 기록",
  same_controller_required: "동일 제어기 응답 확인", state_or_time_mismatch: "실제 보행등과 원천 시각·상태 불일치 검토",
  observation_order_invalid: "관측 시각 순서 확인", two_cycles_required: "적색·녹색 전환 각 2회 관측",
  countdown_unit_required: "같은 상태에서 5초 간격 관측을 늘려 단위 확인",
  same_field_session_required: "30분 이내 같은 현장 검사에서 기록",
};

export function CrossingFieldCheck({ itstId, owner }: { itstId: string; owner: string }) {
  const candidate = crossingCandidates(itstId);
  const [report, setReport] = useState(() => EMPTY(itstId));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [light, setLight] = useState<FieldLight>("red");
  const [retryAt, setRetryAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const active = useRef(true), controller = useRef<AbortController | null>(null);
  const key = `crossing-field:${owner}:${itstId}`;
  useEffect(() => {
    active.current = true;
    void readState<CrossingFieldReport>(key).then((stored) => {
      if (!active.current) return;
      if (stored?.version === 1 && stored.itstId === itstId && Array.isArray(stored.observations) &&
        SIGNAL_DIRECTIONS.includes(stored.direction) && stored.observations.length <= 60 &&
        candidate?.crossings.some((c) => c.managementId === stored.managementId)) setReport(stored);
      setReady(true);
    }).catch(() => { if (active.current) setReady(true); });
    return () => { active.current = false; controller.current?.abort(); };
  }, [key, itstId, candidate]);
  useEffect(() => {
    if (ready) void saveState(key, report).catch(() => setMessage("기기 저장 실패 · JSON을 내려받아 보관하세요."));
  }, [key, ready, report]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  if (!candidate) return <article><h2>실제 횡단보도 대조</h2>
    <p className="muted">공식 도형을 확보한 시범 교차로: 국기원입구 2207, 국기원입구(연등) 22207, 망원역(연등) 20386.</p></article>;
  const selected = candidate.crossings.find((c) => c.managementId === report.managementId);
  const assessment = assessCrossingField(report);
  const points = candidate.crossings.flatMap((c) => [c.point5186, ...(c.polygon5186?.flat() ?? [])]);
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const minX = Math.min(...xs) - 8, maxY = Math.max(...ys) + 8;
  const width = Math.max(...xs) - minX + 8, height = maxY - Math.min(...ys) + 8;
  const locked = busy || report.observations.length > 0 || !!report.entry || !!report.exit;
  const gps = (side: "entry" | "exit") => {
    if (!navigator.geolocation) { setMessage("이 브라우저는 위치 기록을 지원하지 않습니다."); return; }
    setBusy(true); setMessage("");
    navigator.geolocation.getCurrentPosition((position) => {
      if (!active.current) return;
      setReport((r) => ({ ...r, [side]: { coord: [position.coords.longitude, position.coords.latitude],
        accuracyM: position.coords.accuracy, atMs: position.timestamp } }));
      setBusy(false);
    }, () => { if (active.current) { setBusy(false); setMessage("위치 기록 실패. 휴대폰 위치 권한과 수신 상태를 확인하세요."); } },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
  };
  const record = async () => {
    const observedAtMs = Date.now();
    setBusy(true); setMessage(""); controller.current = new AbortController();
    const timeout = setTimeout(() => controller.current?.abort(), 20_000);
    try {
      const payload = await api<unknown>(`signals/seoul?service=current&itstId=${encodeURIComponent(itstId)}`, undefined, controller.current.signal);
      if (!active.current) return;
      const sample = countdownSample(payload, itstId);
      if (!sample?.states[report.direction]) { setMessage("선택한 보행 필드의 최신 응답이 없어 저장하지 않았습니다."); return; }
      setReport((r) => ({ ...r, observations: [...r.observations, { observedAtMs, observed: light, sample }] }));
    } catch (error) {
      if (!active.current) return;
      if (error instanceof ApiRequestError && error.retryAfterMs) setRetryAt(Date.now() + error.retryAfterMs);
      setMessage(error instanceof Error ? error.message : "신호 수신 실패");
    } finally { clearTimeout(timeout); if (active.current) setBusy(false); }
  };
  return <article aria-label="실제 횡단보도 대조">
    <h2>{candidate.name} · 실제 횡단보도 대조</h2>
    <p className="muted">같은 이름으로 찾은 후보입니다. T-GIS 관리번호와 T-DATA 교차로 번호의 동일성은 미확인입니다. 2026년 위치와 2021년 도형을 대조합니다.</p>
    <svg role="img" aria-label="공식 횡단보도 도형과 위치. 위쪽은 북쪽" viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", maxHeight: 260, background: "#16241d", borderRadius: 12 }}>
      {candidate.crossings.map((c, i) => <g key={c.managementId}>
        {c.polygon5186?.map((ring, j) => <polygon key={j} points={ring.map((p) => `${p[0] - minX},${maxY - p[1]}`).join(" ")}
          fill={c.managementId === report.managementId ? "#d2ed71" : c.hasSignal ? "#739b81" : "#374d40"} stroke="#d9e7df" strokeWidth={0.4} />)}
        <circle cx={c.point5186[0] - minX} cy={maxY - c.point5186[1]} r={1.1} fill="#ffffff" />
        <text x={c.point5186[0] - minX + 2} y={maxY - c.point5186[1]} fill="#ffffff" fontSize={3.5}>{i + 1}</text>
      </g>)}
      <text x={3} y={6} fill="#ffffff" fontSize={4}>북 N</text>
      <path d={`M 3 ${height - 6} h 10`} stroke="#ffffff" strokeWidth={.8} />
      <text x={3} y={height - 1} fill="#ffffff" fontSize={3.5}>10m</text>
    </svg>
    <label>실제 횡단보도<select disabled={!ready || locked} value={report.managementId} onChange={(e) => setReport({ ...EMPTY(itstId), managementId: e.target.value })}>
      <option value="">관리번호 선택</option>{candidate.crossings.map((c, i) => <option key={c.managementId} value={c.managementId} disabled={!c.hasSignal}>
        {i + 1}. {c.managementId} · 보행등 {c.hasSignal ? "유" : "무"}</option>)}
    </select></label>
    {selected && <p>T-GIS 교차로 {selected.tgisIntersectionId} · {selected.kind}</p>}
    <label>대조할 보행 필드<select disabled={!ready || locked} value={report.direction} onChange={(e) => setReport((r) => ({ ...r, direction: e.target.value as SignalDirection }))}>
      {SIGNAL_DIRECTIONS.map((d) => <option key={d} value={d}>{d}PdsgStatNm / {d}PdsgRmdrCs</option>)}
    </select></label>
    <p className="muted">휴대폰으로 현장에서 기록하세요. 진입·도착점은 안전한 인도에서 기록합니다. 위치와 관측은 이 기기에만 저장됩니다.</p>
    <div className="button-row">
      <button disabled={!ready || busy || !selected} onClick={() => gps("entry")}>진입점 GPS 기록</button>
      <button disabled={!ready || busy || !selected} onClick={() => gps("exit")}>도착점 GPS 기록</button>
    </div>
    <p>진입점 오차 {report.entry ? `${report.entry.accuracyM.toFixed(1)}m` : "미기록"} · 도착점 오차 {report.exit ? `${report.exit.accuracyM.toFixed(1)}m` : "미기록"}</p>
    <label>지금 직접 본 보행등<select value={light} disabled={busy} onChange={(e) => setLight(e.target.value as FieldLight)}>
      <option value="red">적색</option><option value="green">녹색</option><option value="flashing">녹색 점멸</option><option value="off">소등</option>
    </select></label>
    <div className="button-row">
      <button disabled={!ready || busy || !selected || report.observations.length >= 60 || retryAt > clock} onClick={() => void record()}>
        {busy ? "기록 중…" : retryAt > clock ? `${Math.ceil((retryAt - clock) / 1000)}초 후 재시도` : "직접 본 상태와 API 함께 기록"}</button>
      <button disabled={busy || !report.observations.length} onClick={() => downloadJson(`crossing-field-${itstId}-${report.managementId}.json`, {
        ...report, assessment, catalogSources: SEOUL_CROSSING_CATALOG.sources, containsPreciseLocation: true,
      })}>현장 기록 JSON 내려받기</button>
      <button disabled={busy || !ready} onClick={() => { setReport(EMPTY(itstId)); setMessage(""); }}>새 현장 기록</button>
    </div>
    <p role="status">관측 {report.observations.length}/60 · 녹색 시작 {assessment.greenStarts}회 · 적색 시작 {assessment.redStarts}회</p>
    {message && <p role="alert">{message}</p>}
    <ul>{assessment.reasons.map((reason) => <li key={reason}>{REASONS[reason] ?? reason}</li>)}</ul>
    {assessment.readyForReview && <p>현장 검토자료 준비됨. 관리번호·양끝점·보행 필드 대응을 검토한 뒤 반영합니다.</p>}
    <p className="muted">공식 위치 표시와 현장 기록만 제공합니다. 기록만으로 신호 예측을 켜지 않습니다.</p>
    <small>{SEOUL_CROSSING_CATALOG.attribution} · <a href={SEOUL_CROSSING_CATALOG.sources[0].url} target="_blank" rel="noreferrer">위치 출처</a> · <a href={SEOUL_CROSSING_CATALOG.sources[1].url} target="_blank" rel="noreferrer">도형 출처</a></small>
  </article>;
}
