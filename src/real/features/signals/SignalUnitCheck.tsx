import { useEffect, useState } from "react";
import { api, ApiRequestError } from "../../backend.ts";
import { downloadJson } from "../../storage.ts";
import { countdownSample, estimateCountdownUnit, SIGNAL_DIRECTIONS, type CountdownSample } from "../../signals/countdown-unit.ts";

const SAMPLE_LIMIT = 8;
// A provider quota response applies across intersection changes and remounts.
let blockedUntilMs = 0;

export function SignalUnitCheck({ itstId, disabled = false }: { itstId: string; disabled?: boolean }) {
  const [collecting, setCollecting] = useState(false);
  const [samples, setSamples] = useState<CountdownSample[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!collecting) return;
    let active = true, count = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    function stop() {
      active = false;
      clearTimeout(timer);
      controller.abort();
      setCollecting(false);
    }
    async function read() {
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const payload = await api<unknown>(`signals/seoul?service=current&itstId=${encodeURIComponent(itstId)}`, undefined, controller.signal);
        if (!active) return;
        count++;
        setAttempts(count);
        const sample = countdownSample(payload, itstId);
        if (sample) setSamples((previous) => [...previous, sample]);
        else setMessage("최신 보행신호와 장비·원천 시각을 확인한 표본만 측정에 사용합니다.");
        if (count >= SAMPLE_LIMIT) stop();
        else timer = setTimeout(() => void read(), 5000);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiRequestError && (error.status === 429 || error.retryAfterMs !== null)) {
          const delay = Math.max(error.status === 429 ? 60_000 : 5000, error.retryAfterMs ?? 0);
          blockedUntilMs = Math.max(blockedUntilMs, Date.now() + delay);
          setMessage(`제공기관 재시도 대기 중입니다. ${Math.ceil(delay / 1000)}초 이후 다시 시작하세요.`);
        } else setMessage("수신을 확인하지 못해 측정을 중단했습니다. 잠시 후 다시 시작하세요.");
        stop();
      } finally {
        clearTimeout(timeout);
      }
    }
    function visibilityChanged() {
      if (document.visibilityState === "hidden") {
        setMessage("화면이 숨겨져 측정을 중단했습니다.");
        stop();
      }
    }
    if (document.visibilityState === "hidden") visibilityChanged();
    else if (Date.now() < blockedUntilMs) {
      setMessage(`제공기관 재시도 대기 중입니다. ${Math.ceil((blockedUntilMs - Date.now()) / 1000)}초 이후 다시 시작하세요.`);
      stop();
    } else void read();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [collecting, itstId]);
  const estimates = SIGNAL_DIRECTIONS.filter((direction) => samples.some((s) => s.states[direction]))
    .map((direction) => estimateCountdownUnit(samples, direction));
  return <article>
    <h2>보행 잔여값 단위 측정</h2>
    <p className="muted">최대 8회 조회합니다. 수신 후 5초 간격으로 원천 시각과 잔여값의 감소율을 비교합니다. 횡단보도 대응과 통행 가능 여부는 별도 확인이 필요합니다.</p>
    <div className="button-row">
      <button disabled={disabled || collecting || !/^\d{1,10}$/.test(itstId)} onClick={() => {
        setSamples([]); setAttempts(0); setMessage(""); setCollecting(true);
      }}>단위 측정 시작</button>
      {collecting && <button onClick={() => setCollecting(false)}>측정 중단</button>}
      <button disabled={!samples.length || collecting} onClick={() => downloadJson(`signal-unit-${itstId}.json`, {
        version: 1, itstId, samples, estimates, physicalCrossingVerified: false, predictionReady: false,
      })}>측정 JSON 내려받기</button>
    </div>
    <p role="status">{collecting ? "측정 중" : attempts ? "측정 종료" : "측정 대기"} · 조회 {attempts}/{SAMPLE_LIMIT} · 유효 표본 {samples.length}</p>
    {message && <p role="alert">{message}</p>}
    <ul>{estimates.map((e) => <li key={e.direction}>
      {e.direction} 보행 필드: {e.unit === "deciseconds" ? "1/10초 단위 측정됨" : e.unit === "centiseconds" ? "1/100초 단위 측정됨" : e.reason === "inconsistent" ? "감소율 불일치 · 미확인" : "표본 부족 · 미확인"}
      {` · 비교 ${e.pairs}쌍 · 원천 ${e.observedSourceSec.toFixed(1)}초`}
    </li>)}</ul>
    <p className="muted">이 측정은 선택한 교차로·필드의 단위 근거만 제공합니다. 경로 대기 예측을 자동으로 켜지 않습니다.</p>
  </article>;
}
