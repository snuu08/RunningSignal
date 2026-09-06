import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { currentRoutingPolicy, planStopsFromDraft, useApp } from "../../app/context.tsx";
import { AppHeader, MetricStrip, SoftPill } from "../../components/chrome.tsx";
import { IconHeart } from "../../components/Icons.tsx";
import { RunnerLogo } from "../../components/Logo.tsx";
import { MapRenderer } from "../../components/map/MapRenderer.tsx";
import { Button } from "../../components/ui.tsx";
import { MIN_ROUTE_LOADING_MS } from "../../config/app.ts";
import { geometryFromDirectedIds } from "../../domain/pathfinding.ts";
import {
  defaultGoalPaceSeconds,
  formatDistanceKm,
  formatEstimate,
  formatPaceMarks,
  formatWaitSec,
  travelSeconds,
} from "../../domain/pace.ts";
import {
  describeCoverage,
  describeIncludedObstacles,
  describeTimeline,
  describeVersusBaseline,
} from "../../domain/routing-policy.ts";
import { marksForEvaluation, remainingPathDistanceToCrossing } from "../../domain/crossing-marks.ts";
import type { CrossingPlan, PathEvaluation } from "../../domain/models.ts";
import { popularRunSummary, refreshOwnerPopularStats } from "../../domain/popular.ts";
import { Sheet } from "../../components/Sheet.tsx";

function reasonTitle(via: string): string {
  if (via.includes("공원")) return "공원길을 따라 이어 달려요";
  if (via.includes("골목")) return "연결되는 길을 이어 달려요";
  return "곧은 연결길을 따라 달려요";
}

export function LoadingScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const reqId = useRef(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const id = ++reqId.current;
    const started = Date.now();
    const { draft, providers } = ctx;
    const stops = planStopsFromDraft(draft);
    if (!stops) {
      navigate("/home");
      return;
    }
    const pace = draft.paceSeconds ?? defaultGoalPaceSeconds(ctx.profile?.paces);
    const request = {
      origin: stops.origin,
      destination: stops.destination,
      waypoints: stops.waypoints,
      paceSecondsPerKm: pace,
      departure: { kind: "clock-start" as const, atSec: 0 },
      seed: 7,
      nowSec: 0,
    };
    const result = providers.routes.plan(request, currentRoutingPolicy(ctx));
    const wait = Math.max(0, MIN_ROUTE_LOADING_MS - (Date.now() - started));
    const timer = window.setTimeout(() => {
      if (cancelled.current || id !== reqId.current) return;
      if ("error" in result) {
        navigate("/recommend", { state: { error: result.error } });
        return;
      }
      ctx.setLastRequest(request);
      ctx.setRecommendation(result);
      ctx.setSeenCandidateIds([result.chosen.candidate.id]);
      ctx.setActiveEvaluation(result.chosen);
      navigate("/recommend");
    }, wait);
    return () => {
      cancelled.current = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="app-page">
      <div className="page-body stack" style={{ alignItems: "center", paddingTop: 80 }}>
        <RunnerLogo className="logo-run" />
        <h1 className="h2">루트를 구상하고 있습니다</h1>
        <p className="muted" style={{ textAlign: "center" }}>
          데모 경로와 신호 흐름을 분석하고 있어요.
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            cancelled.current = true;
            navigate("/home");
          }}
        >
          취소
        </Button>
      </div>
    </div>
  );
}

export function RecommendScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const planError = (location.state as { error?: string } | null)?.error;
  const { recommendation, profile, providers, activeEvaluation, setActiveEvaluation } = ctx;
  const [crossing, setCrossing] = useState<CrossingPlan | null>(null);
  const regionId = profile?.regionId ?? "seoul";
  const network = providers.places.getNetwork(regionId);
  const routeKey = (activeEvaluation ?? recommendation?.chosen)?.candidate.id ?? "";

  useEffect(() => {
    setCrossing(null);
  }, [routeKey]);

  if (!recommendation) {
    return (
      <div className="app-page">
        <AppHeader title="추천 루트" onBack={() => navigate("/home")} centerTitle />
        <div className="page-body stack">
          <p>{planError ?? "먼저 출발과 도착을 입력해 루트를 찾아 주세요."}</p>
          <Button variant="primary" onClick={() => navigate("/home")}>
            입력 수정
          </Button>
        </div>
      </div>
    );
  }

  const ev = activeEvaluation ?? recommendation.chosen;
  const pace = ctx.lastRequest?.paceSecondsPerKm ?? null;
  const waitValue = !ev.paceAvailable
    ? "예측 안 함"
    : ev.waitSec.kind === "exact"
      ? formatWaitSec(ev.waitSec.seconds)
      : formatEstimate(ev.waitSec);
  const marks = marksForEvaluation(ev, providers.signals.list(regionId));
  const versus = describeVersusBaseline(recommendation.baseline, ev);

  return (
    <div className="app-page">
      <AppHeader title="이 루트로 가시겠어요?" onBack={() => navigate("/home")} centerTitle />
      <div className="recommend-map">
        <MapRenderer
          network={network}
          route={ev.candidate.geometry}
          origin={ctx.lastRequest?.origin}
          destination={ctx.lastRequest?.destination}
          waypoints={ctx.lastRequest?.waypoints}
          marks={marks}
          showRouteSignals={ctx.settings.showRouteSignals}
          showNearbySignals={ctx.settings.showNearbySignals}
          selectedCrossingId={crossing?.crossingId ?? null}
          onSelectCrossing={(id) =>
            setCrossing(providers.signals.list(regionId).find((c) => c.crossingId === id) ?? null)
          }
          height="100%"
          padding={{ top: 32, right: 32, bottom: 40, left: 32 }}
        />
      </div>
      <div className="page-body stack" style={{ paddingTop: 20 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>
          {ev.stopCount < recommendation.baseline.stopCount && ev.complete
            ? `멈춤이 적은 코스 · ${formatDistanceKm(ev.candidate.lengthM)}`
            : reasonTitle(ev.candidate.viaLabel)}
        </h2>
        <p className="sec" style={{ fontSize: 13, lineHeight: 1.45, margin: 0 }}>
          {recommendation.reason}
        </p>
        <p className="tiny muted">{describeCoverage(ev)}</p>
        {versus ? <p className="tiny muted">{versus}</p> : null}
        <p className="tiny muted">{describeTimeline(ev)}</p>
        {describeIncludedObstacles(ev) ? (
          <p className="tiny muted">{describeIncludedObstacles(ev)}</p>
        ) : null}
        <MetricStrip
          items={[
            { label: "전체 거리", value: formatDistanceKm(ev.candidate.lengthM) },
            {
              label: "이동 페이스",
              value: pace === null ? "미입력" : formatPaceMarks(pace),
            },
            { label: "신호 대기", value: waitValue },
          ]}
        />
        <Button
          variant="primary"
          onClick={() => {
            ctx.setActiveEvaluation(ev);
            navigate("/run");
          }}
        >
          이 루트로 시작
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const next = recommendation.alternatives.find(
              (a) => !ctx.seenCandidateIds.includes(a.candidate.id),
            );
            if (!next) {
              setActiveEvaluation(null);
              navigate("/recommend-empty");
              return;
            }
            ctx.setSeenCandidateIds([...ctx.seenCandidateIds, next.candidate.id]);
            setActiveEvaluation(next);
          }}
        >
          다른 루트 보기
        </Button>
      </div>
      {crossing ? (
        <CrossingDetailSheet
          crossing={crossing}
          evaluation={ev}
          pace={pace}
          onClose={() => setCrossing(null)}
        />
      ) : null}
    </div>
  );
}

export function RecommendEmptyScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  return (
    <div className="app-page">
      <AppHeader title="다른 루트" onBack={() => navigate("/recommend")} centerTitle />
      <div className="page-body stack">
        <p>다른 조건을 만족하는 루트가 없어요. 제한을 무시해서 길을 만들지 않습니다.</p>
        <Button
          variant="primary"
          onClick={() => {
            if (ctx.recommendation) ctx.setActiveEvaluation(ctx.recommendation.chosen);
            navigate("/recommend");
          }}
        >
          이전 후보 보기
        </Button>
        <Button variant="secondary" onClick={() => navigate("/home")}>
          입력 변경
        </Button>
      </div>
    </div>
  );
}

export function PopularDetailScreen() {
  const { cardId } = useParams();
  const [params] = useSearchParams();
  const ctx = useApp();
  const navigate = useNavigate();
  const account = ctx.account;
  const [tryError, setTryError] = useState<string | null>(null);
  const decodedId = decodeURIComponent(cardId ?? "");
  const card = ctx.providers.catalog.get(decodedId);
  const canEdit = Boolean(account && card && card.authorAccountId === account.id);
  const [editingTitle, setEditingTitle] = useState(params.get("edit") === "1" && canEdit);
  const [title, setTitle] = useState(card?.title ?? "");

  useEffect(() => {
    setTitle(card?.title ?? "");
    setEditingTitle(params.get("edit") === "1" && Boolean(account && card?.authorAccountId === account.id));
  }, [card?.title, card?.authorAccountId, account, params]);

  if (!card || !account) {
    return (
      <div className="app-page">
        <AppHeader title="유행하는 루트" onBack={() => navigate("/home")} centerTitle />
        <div className="page-body">
          <p>이 루트를 찾을 수 없습니다.</p>
        </div>
      </div>
    );
  }
  const sourceRoute =
    card.sourceRouteId && card.authorAccountId === account.id
      ? ctx.providers.runs.getRoute(account.id, card.sourceRouteId)
      : null;
  const shown = refreshOwnerPopularStats(card, account.id, sourceRoute);
  const run = popularRunSummary(shown);
  const liked = ctx.providers.catalog.liked(account.id, shown.cardId);
  const network = ctx.providers.places.getNetwork(shown.regionId);
  return (
    <div className="app-page">
      <AppHeader title={shown.title} onBack={() => navigate("/popular")} centerTitle />
      <div className="recommend-map">
        <MapRenderer
          network={network}
          route={
            shown.directedEdgeIds.length > 0
              ? geometryFromDirectedIds(network, shown.directedEdgeIds)
              : []
          }
          origin={shown.origin}
          destination={shown.destination}
          height="100%"
        />
      </div>
      <div className="like-under-map">
        <button
          type="button"
          className={`like-chip${liked ? " liked" : ""}`}
          aria-pressed={liked}
          aria-label={liked ? "공감 취소" : "공감"}
          onClick={() => {
            ctx.providers.catalog.toggleLike(account.id, shown.cardId);
            ctx.refresh();
          }}
        >
          <IconHeart size={16} />
          <span>{ctx.providers.catalog.displayCount(account.id, shown)}</span>
        </button>
      </div>
      <div className="page-body stack" style={{ paddingTop: 12 }}>
        {editingTitle && canEdit ? (
          <input
            className="history-title-input"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const saved = ctx.providers.catalog.renameCard(account.id, shown.cardId, title);
              if (saved) ctx.refresh();
              else setTitle(card.title);
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        ) : (
          <button
            type="button"
            className="history-title"
            onClick={() => {
              if (canEdit) setEditingTitle(true);
            }}
          >
            {card.title}
          </button>
        )}
        <MetricStrip
          className="compact-stats"
          items={[
            { label: "작성자", value: run.author },
            { label: "돌파", value: run.elapsed },
            { label: "평균 페이스", value: run.pace },
          ]}
        />
        <p className="tiny muted">{run.recordNote}</p>
        <SoftPill>{shown.sampleLabel}</SoftPill>
        {canEdit ? <p className="tiny muted">제목을 눌러 바꿀 수 있습니다. 이 기기 데모 목록에만 올라갑니다.</p> : null}
        {tryError ? <p className="error">{tryError}</p> : null}
        <Button
          variant="primary"
          onClick={() => {
            const pace = ctx.draft.paceSeconds ?? defaultGoalPaceSeconds(ctx.profile?.paces);
            ctx.setDraft((prev) => ({
              origin: card.origin,
              destination: card.destination,
              waypoints: [],
              loop: false,
              paceSeconds: prev.paceTouched ? prev.paceSeconds : pace,
              paceTouched: prev.paceTouched,
              paceSkipped: prev.paceSkipped,
              pick: null,
            }));
            const request = {
              origin: card.origin,
              destination: card.destination,
              waypoints: [],
              paceSecondsPerKm: pace,
              departure: { kind: "clock-start" as const, atSec: 0 },
              seed: 7,
              nowSec: 0,
            };
            const result = ctx.providers.routes.plan(request, currentRoutingPolicy(ctx));
            if ("error" in result) {
              setTryError(result.error);
              return;
            }
            ctx.setLastRequest(request);
            ctx.setRecommendation(result);
            ctx.setActiveEvaluation(result.chosen);
            navigate("/run");
          }}
        >
          달려보기
        </Button>
      </div>
    </div>
  );
}

function CrossingDetailSheet({
  crossing,
  evaluation,
  pace,
  onClose,
}: {
  crossing: CrossingPlan;
  evaluation: PathEvaluation;
  pace: number | null;
  onClose: () => void;
}) {
  const remain = remainingPathDistanceToCrossing(evaluation, crossing.directedEdgeId);
  const hit = evaluation.crossings.find((item) => item.directedEdgeId === crossing.directedEdgeId);
  const waitText =
    hit?.wait.kind === "exact"
      ? `${Math.round(hit.wait.seconds)}초`
      : hit?.wait.kind === "unknown"
        ? hit.wait.reason
        : "정보 없음";
  const etaTravel =
    remain !== null && pace ? `${Math.round(travelSeconds(remain, pace))}초 후` : "정보 없음";

  return (
    <Sheet title={crossing.label} onClose={onClose}>
      <div className="stack">
        <p className="tiny muted">보행신호가 있는 횡단보도 · 데모 데이터</p>
        <p>이용하는 횡단: 선택한 경로 방향</p>
        <p>경로상 남은 거리: {remain === null ? "정보 없음" : formatDistanceKm(remain)}</p>
        <p>현재 페이스 기준 도착: {pace ? etaTravel : "정보 없음"}</p>
        <p>도착 시 예상 대기: {evaluation.paceAvailable ? waitText : "정보 없음"}</p>
        <p>현재 신호 상태: 정보 없음</p>
        <p>데이터 갱신: 데모 고정값 · 실시간 아님</p>
        <p>
          예측 가능 여부:{" "}
          {hit?.wait.kind === "exact" ? "이 지점만 예측 가능" : "예측 정보 없음"}
        </p>
        <Button onClick={onClose}>닫기</Button>
      </div>
    </Sheet>
  );
}
