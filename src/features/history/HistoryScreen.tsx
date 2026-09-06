import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp } from "../../app/context.tsx";
import { AppHeader } from "../../components/chrome.tsx";
import { MapThumb } from "../../components/map/MapRenderer.tsx";
import { Button } from "../../components/ui.tsx";
import { NETWORKS } from "../../data/demo/networks.ts";
import {
  defaultGoalPaceSeconds,
  displayRouteElapsedSeconds,
  displayRoutePaceSeconds,
  formatDistanceKm,
  formatDuration,
  formatPaceMarks,
} from "../../domain/pace.ts";
import { RouteDistancePaceSheet } from "../pace/SaveAccountPace.tsx";

export function HistoryScreen() {
  const { routeId } = useParams();
  const ctx = useApp();
  const navigate = useNavigate();
  const account = ctx.account;
  const route = account && routeId ? ctx.providers.runs.getRoute(account.id, routeId) : null;
  const sessions =
    account && routeId ? ctx.providers.runs.listSessions(account.id, routeId) : [];
  const [paceOpen, setPaceOpen] = useState(false);
  const timed = sessions.find((s) => s.times.totalElapsedSec > 0);
  const paceSeconds = route ? displayRoutePaceSeconds(route, timed) : null;
  const elapsedSeconds = route ? displayRouteElapsedSeconds(route, timed) : null;

  if (!route) {
    return (
      <div className="app-page">
        <AppHeader title="기록" onBack={() => navigate("/routes")} centerTitle />
      </div>
    );
  }

  return (
    <div className="app-page">
      <AppHeader title={route.title} onBack={() => navigate("/routes")} centerTitle />
      <div className="page-body stack">
        <div className="route-detail-top">
          <MapThumb network={NETWORKS[route.regionId]} route={route.geometry} />
          <div className="route-detail-pace">
            <div className="metric-label">평균 페이스</div>
            <div className="h2 num-accent">{paceSeconds === null ? "--" : formatPaceMarks(paceSeconds)}</div>
            <div className="metric-label" style={{ marginTop: 10 }}>
              걸린 시간
            </div>
            <div className="h2 num-accent">{elapsedSeconds === null ? "--" : formatDuration(elapsedSeconds)}</div>
          </div>
        </div>
        <p className="tiny muted">
          {route.originLabel} → {route.destinationLabel} · {formatDistanceKm(route.lengthM)}
        </p>
        <Button
          variant="primary"
          onClick={() => {
            const origin = ctx.providers.places.search(route.regionId, route.originLabel)[0];
            const destination = ctx.providers.places.search(route.regionId, route.destinationLabel)[0];
            if (origin && destination) {
              ctx.setDraft((prev) => ({
                origin,
                destination,
                waypoints: [],
                loop: false,
                paceSeconds: prev.paceTouched
                  ? prev.paceSeconds
                  : (defaultGoalPaceSeconds(ctx.profile?.paces) ?? prev.paceSeconds),
                paceTouched: prev.paceTouched,
                paceSkipped: prev.paceSkipped,
                pick: null,
              }));
              navigate("/loading");
            }
          }}
        >
          다시 달리기
        </Button>
        {route.lengthM > 0 ? (
          <Button onClick={() => setPaceOpen(true)}>이 거리로 평균 페이스 저장</Button>
        ) : null}
        {sessions.map((s) => (
          <div className="settings-row" key={s.sessionId}>
            <span>{new Date(s.createdAt).toLocaleString()}</span>
            <span className="tiny muted">
              {s.completion === "partial" ? "부분" : "완주"} · {formatDuration(s.times.totalElapsedSec)}
            </span>
          </div>
        ))}
      </div>
      {paceOpen ? (
        <RouteDistancePaceSheet
          distanceM={route.lengthM}
          routeId={route.routeId}
          initialTotalSeconds={timed?.times.totalElapsedSec ?? null}
          onClose={() => setPaceOpen(false)}
        />
      ) : null}
    </div>
  );
}
