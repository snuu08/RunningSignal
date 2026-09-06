import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { planStopsFromDraft, useApp } from "../../app/context.tsx";
import { AppHeader, MetricStrip, SoftPill } from "../../components/chrome.tsx";
import { IconHeart } from "../../components/Icons.tsx";
import { RunnerLogo } from "../../components/Logo.tsx";
import { MapRenderer } from "../../components/map/MapRenderer.tsx";
import { Button } from "../../components/ui.tsx";
import { MIN_ROUTE_LOADING_MS } from "../../config/app.ts";
import { SAMPLE_CARDS } from "../../data/demo/catalog.ts";
import { geometryFromDirectedIds } from "../../domain/pathfinding.ts";
import {
  effectiveRunPaceSeconds,
  formatDistanceKm,
  formatEstimate,
  formatPaceMarks,
  formatWaitSec,
} from "../../domain/pace.ts";
import type { CrossingPlan, PathEvaluation } from "../../domain/models.ts";

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
    const pace = effectiveRunPaceSeconds(draft.paceSeconds, draft.paceSkipped, ctx.profile?.paces);
    if (pace === null) {
      navigate("/home");
      return;
    }
    const request = {
      origin: stops.origin,
      destination: stops.destination,
      waypoints: stops.waypoints,
      paceSecondsPerKm: pace,
      departure: { kind: "clock-start" as const, atSec: 0 },
      seed: 7,
      nowSec: 0,
    };
    const result = providers.routes.plan(request);
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
  const waitValue =
    ev.waitSec.kind === "exact" ? formatWaitSec(ev.waitSec.seconds) : formatEstimate(ev.waitSec);

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
          crossings={providers.signals.list(regionId)}
          onSelectCrossing={(id) =>
            setCrossing(providers.signals.list(regionId).find((c) => c.crossingId === id) ?? null)
          }
          height="100%"
          padding={{ top: 32, right: 32, bottom: 40, left: 32 }}
        />
      </div>
      <div className="page-body stack" style={{ paddingTop: 20 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>{reasonTitle(ev.candidate.viaLabel)}</h2>
        <p className="sec" style={{ fontSize: 13, lineHeight: 1.45, margin: 0 }}>
          {recommendation.reason}
        </p>
        {!ev.complete ? (
          <p className="tiny muted">확인된 구간 기준입니다. 일부 신호는 예측 불가입니다.</p>
        ) : null}
        <MetricStrip
          items={[
            { label: "전체 거리", value: formatDistanceKm(ev.candidate.lengthM) },
            {
              label: "평균 페이스",
              value: ctx.draft.paceSkipped
                ? "그냥 달리기"
                : formatPaceMarks(ctx.lastRequest?.paceSecondsPerKm ?? 360),
            },
            { label: "신호 대기 시간", value: waitValue },
          ]}
        />
        {crossing ? (
          <p className="tiny muted">
            {crossing.label} · 데모 고정 계획 · {crossing.source}
          </p>
        ) : (
          <p className="tiny muted">권장 페이스: 입력 페이스 유지</p>
        )}
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
  const ctx = useApp();
  const navigate = useNavigate();
  const account = ctx.account;
  const [tryError, setTryError] = useState<string | null>(null);
  const card = SAMPLE_CARDS.find((c) => c.cardId === decodeURIComponent(cardId ?? ""));
  if (!card || !account) {
    return (
      <div className="app-page">
        <AppHeader title="샘플 루트" onBack={() => navigate("/home")} centerTitle />
      </div>
    );
  }
  const liked = ctx.providers.catalog.liked(account.id, card.cardId);
  const network = ctx.providers.places.getNetwork(card.regionId);
  return (
    <div className="app-page">
      <AppHeader title={card.title} onBack={() => navigate("/home")} centerTitle />
      <div className="recommend-map">
        <MapRenderer
          network={network}
          route={geometryFromDirectedIds(network, card.directedEdgeIds)}
          origin={card.origin}
          destination={card.destination}
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
            ctx.providers.catalog.toggleLike(account.id, card.cardId);
            ctx.refresh();
          }}
        >
          <IconHeart size={16} />
          <span>{ctx.providers.catalog.displayCount(account.id, card)}</span>
        </button>
      </div>
      <div className="page-body stack" style={{ paddingTop: 12 }}>
        <SoftPill>{card.sampleLabel}</SoftPill>
        {tryError ? <p className="error">{tryError}</p> : null}
        <Button
          variant="primary"
          onClick={() => {
            const pace = effectiveRunPaceSeconds(
              ctx.draft.paceSeconds,
              ctx.draft.paceSkipped,
              ctx.profile?.paces,
            );
            if (pace === null) {
              setTryError("홈에서 이번 러닝 목표 페이스를 입력하거나, 시간을 입력하지 않고 그냥 달릴래요를 눌러 주세요.");
              return;
            }
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
            const result = ctx.providers.routes.plan(request);
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
