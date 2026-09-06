import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../../app/context.tsx";
import { Brand, SoftPill } from "../../components/chrome.tsx";
import { MapRenderer } from "../../components/map/MapRenderer.tsx";
import { Button } from "../../components/ui.tsx";
import { Sheet } from "../../components/Sheet.tsx";
import { effectiveRunPaceSeconds, formatDuration } from "../../domain/pace.ts";
import { buildJustRunPlan, JustRunTracker } from "../../domain/just-run.ts";

export function JustRunScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const pace = effectiveRunPaceSeconds(
    ctx.draft.paceSeconds,
    ctx.draft.paceSkipped,
    ctx.profile?.paces,
  );
  const regionId = ctx.profile?.regionId ?? "seoul";
  const start = ctx.providers.places.demoStart(regionId);
  const network = ctx.providers.places.getNetwork(regionId);
  const [tick, setTick] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const trackerRef = useRef<JustRunTracker | null>(null);

  useEffect(() => {
    if (!pace) return;
    trackerRef.current = new JustRunTracker(pace, start.point);
    setTick((n) => n + 1);
  }, [pace, start.point.x, start.point.y]);

  useEffect(() => {
    const id = window.setInterval(() => {
      trackerRef.current?.tick();
      setTick((n) => n + 1);
    }, 80);
    return () => window.clearInterval(id);
  }, []);

  const finishAndShow = () => {
    const tracker = trackerRef.current;
    if (!tracker || !pace || !ctx.account) return;
    const summary = tracker.finish();
    const plan = buildJustRunPlan(start, pace, regionId, tracker.track, summary.distanceM);
    const session = {
      sessionId: crypto.randomUUID(),
      accountId: ctx.account.id,
      routeId: null,
      title: "Just RUN!",
      source: "demo" as const,
      phase: tracker.phase,
      runningSub: "moving" as const,
      pauseReason: tracker.pauseReason,
      saveState: "unsaved" as const,
      completion: "full" as const,
      planned: {
        request: plan.request,
        evaluation: plan.evaluation,
      },
      actualDirectedEdgeIds: [],
      progressM: summary.distanceM,
      times: { ...tracker.times },
      simSpeed: 1 as const,
      startedAtSec: tracker.startedAtSec,
      endedAtSec: tracker.times.totalElapsedSec,
      createdAt: Date.now(),
      justRunSummary: summary,
    };
    ctx.setJustRun(true);
    ctx.setLastRequest(plan.request);
    ctx.setPendingSession(session);
    ctx.providers.runs.writeSnapshot(ctx.account.id, session);
    navigate("/result");
  };

  if (!pace) {
    return (
      <div className="app-page">
        <header className="app-header">
          <Brand onClick={() => navigate("/home")} />
        </header>
        <div className="page-body stack" style={{ paddingTop: 16 }}>
          <p className="error">이번 러닝 목표 페이스를 입력하거나, 시간을 입력하지 않고 그냥 달릴래요를 눌러 주세요.</p>
          <Button variant="primary" onClick={() => navigate("/home")}>
            홈으로
          </Button>
        </div>
      </div>
    );
  }

  const tracker = trackerRef.current;
  const phase = tracker?.phase ?? "ready";
  void tick;

  return (
    <div className="app-page">
      <header className="app-header">
        <Brand onClick={() => navigate("/home")} />
        <div className="header-title">Just RUN!</div>
        <SoftPill>데모</SoftPill>
      </header>
      <div className="page-body stack" style={{ paddingTop: 12 }}>
        <p className="tiny muted">지금은 가상 GPS만 기록합니다. 거리·바퀴·페이스는 종료 후에 계산합니다.</p>
        <div style={{ height: 180 }}>
          <MapRenderer
            network={network}
            origin={start}
            destination={start}
            route={tracker?.track}
            runner={tracker?.track[tracker.track.length - 1] ?? start.point}
            framed
            showBadge={false}
            height={180}
          />
        </div>
        <p className="tiny muted">가상 지도 · 실제 길 안내가 아닙니다</p>
        <div className="pace-hero">
          <div className="num" style={{ fontSize: 42 }}>
            {formatDuration(tracker?.times.totalElapsedSec ?? 0)}
          </div>
          <div className="cap">{phase === "ready" ? "기록 대기" : phase === "paused" ? "일시정지" : "기록 중"}</div>
        </div>
        {phase === "ready" ? (
          <Button
            variant="primary"
            onClick={() => {
              trackerRef.current?.start();
              setTick((n) => n + 1);
            }}
          >
            시작
          </Button>
        ) : null}
        {phase === "running" ? (
          <Button
            variant="primary"
            onClick={() => {
              trackerRef.current?.pause("manual");
              setTick((n) => n + 1);
            }}
          >
            일시정지
          </Button>
        ) : null}
        {phase === "paused" ? (
          <Button
            variant="primary"
            onClick={() => {
              trackerRef.current?.resume();
              setTick((n) => n + 1);
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
          <Button variant="secondary" onClick={() => navigate("/home")}>
            홈으로
          </Button>
        )}
      </div>
      {confirmEnd ? (
        <Sheet title="기록 종료" onClose={() => setConfirmEnd(false)}>
          <p>가상 GPS 궤적으로 거리·바퀴·페이스를 계산합니다.</p>
          <Button variant="primary" onClick={finishAndShow}>
            계산하고 결과 보기
          </Button>
          <Button variant="secondary" onClick={() => setConfirmEnd(false)}>
            돌아가기
          </Button>
        </Sheet>
      ) : null}
    </div>
  );
}
