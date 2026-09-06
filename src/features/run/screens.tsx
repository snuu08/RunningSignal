import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../../app/context.tsx";
import { Brand, SoftPill } from "../../components/chrome.tsx";
import { IconTurn } from "../../components/Icons.tsx";
import { MapRenderer } from "../../components/map/MapRenderer.tsx";
import { Sheet } from "../../components/Sheet.tsx";
import { Button } from "../../components/ui.tsx";
import { DemoSimClock } from "../../domain/clock.ts";
import type { RouteRequest, RunSession } from "../../domain/models.ts";
import {
  elapsedPace,
  formatDistanceKm,
  formatDuration,
  formatPace,
  formatPaceMarks,
  movingPace,
} from "../../domain/pace.ts";
import { RunSimulator } from "../../domain/run-simulation.ts";
import { evaluatePath, remainingToNextCrossing } from "../../domain/signals.ts";
import { RouteDistancePaceSheet } from "../pace/SaveAccountPace.tsx";

export function RunScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const ev = ctx.activeEvaluation;
  const regionId = ctx.profile?.regionId ?? "seoul";
  const network = ctx.providers.places.getNetwork(regionId);
  const [camera, setCamera] = useState<"fit" | "follow">("fit");
  const [speed, setSpeed] = useState<1 | 10 | 30>(1);
  const [tick, setTick] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [nearSignalStart, setNearSignalStart] = useState(false);
  const [options, setOptions] = useState(false);
  const simRef = useRef<RunSimulator | null>(null);
  const clockRef = useRef<DemoSimClock | null>(null);

  useEffect(() => {
    if (!ev || !ctx.lastRequest) return;
    const clock = new DemoSimClock(ctx.lastRequest.departure.atSec, 1);
    clock.freeze();
    const startEv = evaluatePath(
      ev.candidate,
      ctx.lastRequest.paceSecondsPerKm,
      clock.nowSec(),
      ctx.providers.signals.lookup(regionId),
    );
    const sim = new RunSimulator(startEv, clock, ctx.lastRequest.paceSecondsPerKm);
    if (ctx.account) {
      const snap = ctx.providers.runs.readSnapshot(ctx.account.id);
      if (snap && snap.planned.evaluation.candidate.fingerprint === ev.candidate.fingerprint) {
        sim.restore({
          phase: snap.phase,
          runningSub: snap.runningSub,
          pauseReason: "restored",
          progressM: snap.progressM,
          times: snap.times,
          simSpeed: snap.simSpeed,
          lastTickSec: 0,
          waitingUntilSec: null,
          startedAtSec: snap.startedAtSec,
        });
      }
    }
    simRef.current = sim;
    clockRef.current = clock;
    setTick((n) => n + 1);
  }, [ev, ctx.lastRequest]);

  useEffect(() => {
    const id = window.setInterval(() => {
      simRef.current?.tick();
      persist();
      setTick((n) => n + 1);
      if (simRef.current?.phase === "completed") navigate("/result");
    }, 80);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && simRef.current?.phase === "running") {
        clockRef.current?.freeze();
        simRef.current.pause("auto-hidden");
        setTick((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const persist = () => {
    const sim = simRef.current;
    if (!sim || !ctx.account || !ctx.lastRequest) return;
    const session = toSession(ctx.account.id, sim, ctx.lastRequest);
    ctx.providers.runs.writeSnapshot(ctx.account.id, session);
    ctx.setPendingSession(session);
  };

  if (!ev || !ctx.lastRequest) {
    return (
      <div className="app-page">
        <div className="page-body">
          <Button variant="primary" onClick={() => navigate("/home")}>
            홈으로
          </Button>
        </div>
      </div>
    );
  }

  const sim = simRef.current;
  const phase = sim?.phase ?? "ready";
  const waiting = sim?.runningSub === "waitingAtSignal";
  const nextM = remainingToNextCrossing(ev, sim?.progressM ?? 0);
  const statusLabel =
    phase === "ready" ? "준비" : waiting ? "신호 대기" : phase === "paused" ? "일시정지" : "러닝 중";
  void tick;

  return (
    <div className="app-page run-page">
      <header className="app-header">
        <Brand onClick={() => navigate("/home")} />
        <div className="header-title">{statusLabel}</div>
        <SoftPill>시뮬레이션</SoftPill>
      </header>
      <div className="run-map">
        <MapRenderer
          network={network}
          route={ev.candidate.geometry}
          origin={ctx.lastRequest.origin}
          destination={ctx.lastRequest.destination}
          runner={sim?.position() ?? ev.candidate.geometry[0]}
          crossings={ctx.providers.signals.list(regionId)}
          camera={camera}
          height="100%"
        />
      </div>
      <div className="page-body" style={{ paddingTop: 8 }}>
        <div className="pace-hero">
          <div className="num">
            {ctx.draft.paceSkipped ? "그냥 달리기" : formatPaceMarks(ctx.lastRequest.paceSecondsPerKm)}
          </div>
          <div className="cap">평균 페이스</div>
        </div>
        <div className="dual-stats" style={{ marginTop: 16 }}>
          <div className="stat">
            <div className="lbl">거리</div>
            <div className="val">{formatDistanceKm(sim?.progressM ?? 0)}</div>
          </div>
          <div className="stat">
            <div className="lbl">시간</div>
            <div className="val">{formatDuration(sim?.times.totalElapsedSec ?? 0)}</div>
          </div>
        </div>
        <div className="next-signal">
          <IconTurn size={18} />
          <span>
            다음 신호까지{" "}
            <b>{nextM === null ? "--" : `${Math.round(nextM)}m`}</b>
          </span>
        </div>
        {waiting ? <p className="tiny muted">신호 대기 중 · 이동거리는 늘지 않습니다</p> : null}
        {phase === "paused" ? (
          <p className="tiny muted">
            {sim?.pauseReason === "manual" ? "시뮬레이션 일시정지" : "이어달리기를 눌러 계속하세요"}
          </p>
        ) : null}

        <div className="stack" style={{ marginTop: 8 }}>
          {phase === "ready" ? (
            <Button
              variant="primary"
              onClick={() => {
                clockRef.current?.unfreeze();
                simRef.current?.start();
                persist();
              }}
            >
              시작
            </Button>
          ) : null}
          {phase === "running" ? (
            <Button
              variant="primary"
              onClick={() => {
                clockRef.current?.freeze();
                simRef.current?.pause("manual");
              }}
            >
              일시정지
            </Button>
          ) : null}
          {phase === "paused" ? (
            <Button
              variant="primary"
              onClick={() => {
                clockRef.current?.unfreeze();
                simRef.current?.resume();
              }}
            >
              계속하기
            </Button>
          ) : null}
          {phase !== "ready" ? (
            <Button variant="secondary" onClick={() => setConfirmEnd(true)}>
              종료
            </Button>
          ) : (
            <button type="button" className="more-link" onClick={() => setOptions(true)}>
              시뮬레이션 옵션
            </button>
          )}
          {phase !== "ready" ? (
            <button type="button" className="more-link" onClick={() => setOptions(true)}>
              배속 · 지도
            </button>
          ) : null}
        </div>
      </div>

      {confirmEnd ? (
        <Sheet title="러닝 종료" onClose={() => setConfirmEnd(false)}>
          <p>이 러닝을 종료할까요? 진행 기록은 바로 지워지지 않습니다.</p>
          <Button
            variant="primary"
            onClick={() => {
              simRef.current?.finish((sim?.progressM ?? 0) < ev.candidate.lengthM - 1);
              persist();
              navigate("/result");
            }}
          >
            종료하고 결과 보기
          </Button>
          <Button variant="secondary" onClick={() => setConfirmEnd(false)}>
            돌아가기
          </Button>
        </Sheet>
      ) : null}

      {options ? (
        <Sheet title="시뮬레이션 옵션" onClose={() => setOptions(false)}>
          <p className="tiny muted">배속은 시뮬레이션 시간에만 적용되고 입력 페이스는 바꾸지 않습니다.</p>
          <div className="row">
            {([1, 10, 30] as const).map((s) => (
              <button
                key={s}
                className="check-row"
                aria-pressed={speed === s}
                onClick={() => {
                  setSpeed(s);
                  clockRef.current?.setSpeed(s);
                  simRef.current?.setSpeed(s);
                }}
              >
                {s}×
              </button>
            ))}
          </div>
          <button
            className="check-row"
            aria-pressed={camera === "fit"}
            onClick={() => setCamera("fit")}
          >
            전체 경로
          </button>
          <button
            className="check-row"
            aria-pressed={camera === "follow"}
            onClick={() => setCamera("follow")}
          >
            내 위치 따라가기
          </button>
          {phase === "ready" ? (
            <label className="row" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={nearSignalStart}
                onChange={(e) => setNearSignalStart(e.target.checked)}
              />
              데모 신호 기준으로 시작
            </label>
          ) : null}
        </Sheet>
      ) : null}
    </div>
  );
}

function toSession(
  accountId: string,
  sim: RunSimulator,
  request: RouteRequest,
): RunSession {
  return {
    sessionId: sessionIdFor(sim),
    accountId,
    routeId: null,
    title: "",
    source: "demo",
    phase: sim.phase,
    runningSub: sim.runningSub,
    pauseReason: sim.pauseReason,
    saveState: "unsaved",
    completion:
      sim.phase === "completed"
        ? sim.progressM >= sim.lengthM - 1
          ? "full"
          : "partial"
        : null,
    planned: {
      request,
      evaluation: sim.evaluation,
    },
    actualDirectedEdgeIds: sim.evaluation.candidate.directedEdges.map((e) => e.directedEdgeId),
    progressM: sim.progressM,
    times: { ...sim.times },
    simSpeed: sim.simSpeed,
    startedAtSec: sim.startedAtSec,
    endedAtSec: sim.phase === "completed" ? sim.times.totalElapsedSec : null,
    createdAt: Date.now(),
  };
}

const sessionMemo = new Map<RunSimulator, string>();
function sessionIdFor(sim: RunSimulator): string {
  const existing = sessionMemo.get(sim);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionMemo.set(sim, id);
  return id;
}

export function ResultScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const session = ctx.pendingSession;
  const [paceOpen, setPaceOpen] = useState(false);

  if (!session || !ctx.account || !ctx.lastRequest) {
    return (
      <div className="app-page">
        <div className="page-body">
          <Button variant="primary" onClick={() => navigate("/home")}>
            홈
          </Button>
        </div>
      </div>
    );
  }

  const routes = ctx.providers.runs.listRoutes(ctx.account.id);
  const same = routes.find((r) => r.fingerprint === session.planned.evaluation.candidate.fingerprint);
  const prevBest = same
    ? ctx.providers.runs
        .listSessions(ctx.account.id, same.routeId)
        .filter((s) => s.completion === "full")
        .sort((a, b) => a.times.totalElapsedSec - b.times.totalElapsedSec)[0]
    : null;

  const justRun = ctx.justRun || session.title === "Just RUN!";
  const headline = justRun
    ? "움직인 거리를 기록했어요."
    : !same && session.completion === "full"
      ? "첫 러닝을 기록했어요."
      : session.completion === "full" &&
          prevBest &&
          session.times.totalElapsedSec < prevBest.times.totalElapsedSec
        ? "새로운 최고 기록이에요!"
        : "오늘도 수고하셨어요.";

  const moveP = movingPace(session.times.movingSec, session.progressM);
  const allP = elapsedPace(session.times.totalElapsedSec, session.progressM);

  return (
    <div className="app-page">
      <header className="app-header">
        <Brand />
        <SoftPill>{justRun ? "데모 계산 결과" : "시뮬레이션 결과"}</SoftPill>
      </header>
      <div className="page-body stack" style={{ paddingTop: 16 }}>
        {justRun ? (
          <>
            <div style={{ height: 168 }}>
              <MapRenderer
                network={ctx.providers.places.getNetwork(ctx.profile?.regionId ?? "seoul")}
                origin={ctx.lastRequest.origin}
                destination={ctx.lastRequest.origin}
                route={session.planned.evaluation.candidate.geometry}
                framed
                showBadge={false}
                height={168}
              />
            </div>
            <p className="tiny muted">가상 지도 · 실제 길 안내가 아닙니다</p>
          </>
        ) : null}
        <div className="pace-hero">
          <div className="num" style={{ fontSize: 42 }}>
            {justRun
              ? (session.justRunSummary?.paceSeconds
                  ? formatPaceMarks(session.justRunSummary.paceSeconds)
                  : "--")
              : formatDuration(session.times.totalElapsedSec)}
          </div>
          <div className="cap">{justRun ? "계산된 평균 페이스" : headline}</div>
        </div>
        <div className="dual-stats">
          <div className="stat">
            <div className="lbl">거리</div>
            <div className="val">
              {formatDistanceKm(justRun ? (session.justRunSummary?.distanceM ?? session.progressM) : session.progressM)}
            </div>
          </div>
          <div className="stat">
            <div className="lbl">{justRun ? "돈 횟수" : "이동 페이스"}</div>
            <div className="val">
              {justRun
                ? `${session.justRunSummary?.laps ?? 0}바퀴`
                : moveP
                  ? formatPaceMarks(moveP)
                  : "--"}
            </div>
          </div>
        </div>
        <p className="tiny muted">
          {justRun
            ? `이동 ${formatDuration(session.times.movingSec)} · 가상 GPS 경로로 계산 · 실제 위치가 아닙니다`
            : `이동 ${formatDuration(session.times.movingSec)} · 신호 대기 ${formatDuration(session.times.signalWaitSec)} · 수동 일시정지 ${formatDuration(session.times.manualPauseSec)}`}
        </p>
        <p className="tiny muted">
          정지 포함 페이스 {allP ? formatPace(allP) : "--"} (전체 경과시간/거리)
        </p>
        {session.completion === "partial" ? (
          <p className="tiny muted">부분 기록입니다. 완주 최고기록과 비교하지 않습니다.</p>
        ) : null}
        <p>이 러닝을 기록하시겠어요?</p>
        <Button
          variant="primary"
          onClick={() => {
            if (!ctx.account || !ctx.lastRequest) return;
            const evaln = session.planned.evaluation;
            const saved = ctx.providers.runs.saveSession(ctx.account.id, session, {
              routeId: same?.routeId ?? crypto.randomUUID(),
              accountId: ctx.account.id,
              title:
                same?.title ||
                (justRun ? "Just RUN!" : `${ctx.lastRequest.origin.label} → ${ctx.lastRequest.destination.label}`),
              fingerprint: evaln.candidate.fingerprint,
              directedEdgeIds: evaln.candidate.directedEdges.map((e) => e.directedEdgeId),
              geometry: evaln.candidate.geometry.slice(
                0,
                Math.max(
                  2,
                  Math.ceil(
                    (session.progressM / Math.max(evaln.candidate.lengthM, 1)) *
                      evaln.candidate.geometry.length,
                  ),
                ),
              ),
              geometryVersion: evaln.candidate.directedEdges[0]?.geometryVersion ?? 1,
              lengthM: justRun ? session.progressM : evaln.candidate.lengthM,
              regionId: ctx.profile?.regionId ?? "seoul",
              originLabel: justRun ? "Just RUN!" : ctx.lastRequest.origin.label,
              destinationLabel: justRun ? "목적지 없음" : ctx.lastRequest.destination.label,
              source: "demo",
              createdAt: Date.now(),
            });
            ctx.providers.runs.writeSnapshot(ctx.account.id, null);
            ctx.setPendingSession(null);
            ctx.setPendingRenameRouteId(saved.route.routeId);
            ctx.setJustRun(false);
            navigate("/home");
          }}
        >
          나의 루트에 저장하고 홈으로
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            if (ctx.account) ctx.providers.runs.writeSnapshot(ctx.account.id, null);
            ctx.setPendingSession(null);
            ctx.setJustRun(false);
            navigate("/home");
          }}
        >
          저장하지 않고, 홈으로
        </Button>
        {session.progressM > 0 || session.planned.evaluation.candidate.lengthM > 0 ? (
          <Button onClick={() => setPaceOpen(true)}>이 거리로 평균 페이스 저장</Button>
        ) : null}
      </div>
      {paceOpen ? (
        <RouteDistancePaceSheet
          distanceM={
            session.progressM > 0 ? session.progressM : session.planned.evaluation.candidate.lengthM
          }
          routeId={same?.routeId}
          initialTotalSeconds={session.times.totalElapsedSec}
          onClose={() => setPaceOpen(false)}
        />
      ) : null}
    </div>
  );
}
