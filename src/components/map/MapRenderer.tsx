import { useEffect, useMemo, useRef, useState } from "react";
import { boundsOf } from "../../domain/geo.ts";
import { filterCrossingMarks, type CrossingMark } from "../../domain/crossing-marks.ts";
import type {
  CrossingPlan,
  LocalMetersPoint,
  PlaceRef,
  WalkingNetwork,
} from "../../domain/models.ts";

type Camera = "fit" | "follow";

type MapRendererProps = {
  network: WalkingNetwork;
  route?: LocalMetersPoint[];
  altRoute?: LocalMetersPoint[];
  origin?: PlaceRef | null;
  destination?: PlaceRef | null;
  waypoints?: PlaceRef[];
  crossings?: CrossingPlan[];
  marks?: CrossingMark[];
  runner?: LocalMetersPoint | null;
  selectedCrossingId?: string | null;
  onSelectPoint?: (point: LocalMetersPoint) => void;
  onSelectCrossing?: (id: string) => void;
  camera?: Camera;
  thumbnail?: boolean;
  height?: number | string;
  padding?: { top: number; right: number; bottom: number; left: number };
  framed?: boolean;
  showControls?: boolean;
  showBadge?: boolean;
  showRouteSignals?: boolean;
  showNearbySignals?: boolean;
};

function splitAccent(route: LocalMetersPoint[]): {
  base: LocalMetersPoint[];
  accent: LocalMetersPoint[];
} {
  if (route.length < 4) return { base: route, accent: [] };
  const cut = Math.max(2, Math.floor(route.length * 0.68));
  return { base: route.slice(0, cut + 1), accent: route.slice(cut) };
}

function roadWidth(kind: string): number {
  if (kind === "bridge") return 2.6;
  if (kind === "sidewalk") return 2.2;
  if (kind === "park_path") return 1.8;
  if (kind === "alley") return 1.35;
  return 1.6;
}

export function MapRenderer({
  network,
  route,
  altRoute,
  origin,
  destination,
  waypoints = [],
  crossings = [],
  marks,
  runner,
  selectedCrossingId,
  onSelectPoint,
  onSelectCrossing,
  camera = "fit",
  thumbnail = false,
  height,
  padding = { top: 32, right: 32, bottom: 36, left: 32 },
  framed = false,
  showControls,
  showBadge,
  showRouteSignals = true,
  showNearbySignals = false,
}: MapRendererProps) {
  const controls = showControls ?? (!thumbnail && !framed);
  const badge = showBadge ?? !thumbnail;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 240 });
  const [view, setView] = useState(network.bounds);
  const drag = useRef<{ x: number; y: number; view: typeof view } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    obs.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => obs.disconnect();
  }, []);

  const focusPoints = useMemo(() => {
    const pts: LocalMetersPoint[] = [];
    if (route && route.length > 0) pts.push(...route);
    if (origin) pts.push(origin.point);
    if (destination) pts.push(destination.point);
    waypoints.forEach((w) => pts.push(w.point));
    if (camera === "follow" && runner) pts.push(runner);
    return pts;
  }, [route, origin, destination, waypoints, camera, runner]);

  useEffect(() => {
    const padM = thumbnail ? 40 : 90;
    const next =
      camera === "follow" && runner
        ? {
            minX: runner.x - 180,
            maxX: runner.x + 180,
            minY: runner.y - 180,
            maxY: runner.y + 180,
          }
        : (() => {
            const base = focusPoints.length > 0 ? boundsOf(focusPoints) : network.bounds;
            return {
              minX: base.minX - padM,
              maxX: base.maxX + padM,
              minY: base.minY - padM,
              maxY: base.maxY + padM,
            };
          })();
    setView((prev) => {
      if (
        Math.abs(prev.minX - next.minX) < 0.5 &&
        Math.abs(prev.maxX - next.maxX) < 0.5 &&
        Math.abs(prev.minY - next.minY) < 0.5 &&
        Math.abs(prev.maxY - next.maxY) < 0.5
      ) {
        return prev;
      }
      return next;
    });
  }, [camera, runner, focusPoints, network.bounds, thumbnail]);

  const usedPad = thumbnail
    ? { top: 8, right: 8, bottom: 8, left: 8 }
    : padding;
  const vbW = Math.max(1, view.maxX - view.minX);
  const vbH = Math.max(1, view.maxY - view.minY);
  const innerW = Math.max(40, size.w - usedPad.left - usedPad.right);
  const innerH = Math.max(40, size.h - usedPad.top - usedPad.bottom);
  const scale = Math.min(innerW / vbW, innerH / vbH);
  const ox = usedPad.left + (innerW - vbW * scale) / 2;
  const oy = usedPad.top + (innerH - vbH * scale) / 2;

  const toScreen = (p: LocalMetersPoint) => ({
    x: ox + (p.x - view.minX) * scale,
    y: oy + (p.y - view.minY) * scale,
  });

  const fromScreen = (x: number, y: number): LocalMetersPoint => ({
    system: "local-meters",
    x: view.minX + (x - ox) / scale,
    y: view.minY + (y - oy) / scale,
  });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (thumbnail) return;
    drag.current = { x: e.clientX, y: e.clientY, view };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.x) / scale;
    const dy = (e.clientY - drag.current.y) / scale;
    setView({
      minX: drag.current.view.minX - dx,
      maxX: drag.current.view.maxX - dx,
      minY: drag.current.view.minY - dy,
      maxY: drag.current.view.maxY - dy,
    });
  };

  const endDrag = () => {
    drag.current = null;
  };

  const fitAll = () => {
    const pts = focusPoints.length > 0 ? focusPoints : Object.values(network.nodes).map((n) => n.point);
    const b = boundsOf(pts);
    setView({ minX: b.minX - 90, maxX: b.maxX + 90, minY: b.minY - 90, maxY: b.maxY + 90 });
  };

  const accent = route && route.length > 1 ? splitAccent(route) : null;

  return (
    <div
      ref={wrapRef}
      className={`map-wrap${thumbnail ? "" : " hero"}${framed ? " framed" : ""}`}
      style={{ height: height ?? (thumbnail ? "100%" : "100%"), minHeight: thumbnail ? undefined : 160 }}
    >
      <svg
        width="100%"
        height="100%"
        role="img"
        aria-label="가상 지도"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(e) => {
          if (!onSelectPoint || thumbnail) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onSelectPoint(fromScreen(e.clientX - rect.left, e.clientY - rect.top));
        }}
      >
        <rect width="100%" height="100%" fill="var(--map-land)" />
        {network.features.map((f) => {
          if (f.kind === "block") {
            const pts = f.polygon.map(toScreen);
            return (
              <polygon
                key={f.id}
                points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="#181c1e"
                stroke="#101214"
              />
            );
          }
          if (f.kind === "park") {
            return (
              <polygon
                key={f.id}
                points={f.polygon.map(toScreen).map((p) => `${p.x},${p.y}`).join(" ")}
                fill="var(--map-park)"
              />
            );
          }
          if (f.kind === "river") {
            return (
              <polygon
                key={f.id}
                points={f.polygon.map(toScreen).map((p) => `${p.x},${p.y}`).join(" ")}
                fill="var(--map-water)"
              />
            );
          }
          return null;
        })}
        {Object.values(network.edges).map((edge) => {
          const pts = edge.geometry.map(toScreen);
          return (
            <polyline
              key={edge.id}
              points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="var(--map-road)"
              strokeWidth={roadWidth(edge.walkKind)}
              strokeLinecap="round"
            />
          );
        })}
        {altRoute && altRoute.length > 1 ? (
          <polyline
            points={altRoute.map(toScreen).map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#f5f5f5"
            strokeWidth={2.2}
            strokeDasharray="5 6"
            opacity={0.45}
          />
        ) : null}
        {accent ? (
          <>
            <polyline
              points={accent.base.map(toScreen).map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="var(--route)"
              strokeWidth={2.8}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {accent.accent.length > 1 ? (
              <polyline
                points={accent.accent.map(toScreen).map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="var(--route-accent)"
                strokeWidth={2.8}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
          </>
        ) : null}
        {!thumbnail
          ? filterCrossingMarks(
              marks ??
                crossings.map((plan) => ({
                  plan,
                  onRoute: true,
                  info: "unknown" as const,
                  waitSec: null,
                  next: false,
                })),
              {
                showRouteSignals,
                showNearbySignals,
                selectedCrossingId,
                viewSpanM: Math.max(view.maxX - view.minX, view.maxY - view.minY),
              },
            ).map((mark) => {
              const p = toScreen(mark.plan.point);
              const selected = mark.plan.crossingId === selectedCrossingId;
              const compact = size.w < 280;
              const label = mark.next
                ? "다음 횡단"
                : mark.info === "location-only"
                  ? "예측 없음"
                  : mark.info === "predictable" && mark.waitSec !== null && mark.waitSec > 0 && selected
                    ? `${Math.round(mark.waitSec)}초`
                    : "";
              return (
                <g
                  key={mark.plan.crossingId}
                  opacity={mark.onRoute ? 1 : 0.28}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCrossing?.(mark.plan.crossingId);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${mark.plan.label}, ${mark.info === "location-only" ? "예측 정보 없음" : "보행신호"}`}
                >
                  <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
                  <rect
                    x={p.x - 5}
                    y={p.y - 8}
                    width={10}
                    height={14}
                    rx={2}
                    fill={selected || mark.next ? "#f5f5f5" : "#8a8e93"}
                    stroke="#111"
                    strokeWidth={1}
                  />
                  <rect x={p.x - 2.4} y={p.y - 5} width={2} height={3} fill="#111" />
                  <rect x={p.x + 0.4} y={p.y - 5} width={2} height={3} fill="#111" />
                  {!compact && label ? (
                    <text x={p.x + 10} y={p.y + 4} fill="#d4d6d8" fontSize="10">
                      {label}
                    </text>
                  ) : null}
                </g>
              );
            })
          : null}
        {origin && !thumbnail ? (
          <Marker p={toScreen(origin.point)} label="출발" kind="start" />
        ) : null}
        {destination && !thumbnail ? (
          <Marker p={toScreen(destination.point)} label="도착" kind="end" />
        ) : null}
        {waypoints.map((w, i) => (
          <Marker key={w.placeId} p={toScreen(w.point)} label={`경유 ${i + 1}`} kind="via" />
        ))}
        {runner ? (
          <g>
            <circle
              cx={toScreen(runner).x}
              cy={toScreen(runner).y}
              r={10}
              fill="#8cdda2"
              opacity={0.22}
            />
            <circle
              cx={toScreen(runner).x}
              cy={toScreen(runner).y}
              r={6}
              fill="#f5f5f5"
              stroke="#8cdda2"
              strokeWidth={2}
            />
          </g>
        ) : null}
      </svg>
      {badge ? <div className="virtual-pill">가상 지도</div> : null}
      {controls ? (
        <div className="map-tools">
          <button type="button" onClick={fitAll} aria-label="전체 보기">
            전체
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Marker({
  p,
  label,
  kind,
}: {
  p: { x: number; y: number };
  label: string;
  kind: "start" | "end" | "via";
}) {
  const stroke = kind === "start" ? "#8cdda2" : kind === "end" ? "#f5f5f5" : "#898d92";
  return (
    <g>
      <circle cx={p.x} cy={p.y} r={5.5} fill="none" stroke={stroke} strokeWidth={1.6} />
      <circle cx={p.x} cy={p.y} r={2} fill={stroke} />
      <text x={p.x + 8} y={p.y - 8} fill="#b0b2b5" fontSize="11">
        {label}
      </text>
    </g>
  );
}

export function MapThumb({
  network,
  route,
}: {
  network: WalkingNetwork;
  route: LocalMetersPoint[];
}) {
  return (
    <div className="thumb" aria-hidden="true">
      <MapRenderer network={network} route={route} thumbnail height="100%" />
    </div>
  );
}
