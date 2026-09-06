import { useMemo, useState } from "react";
import { MapRenderer } from "../../components/map/MapRenderer.tsx";
import { Button } from "../../components/ui.tsx";
import {
  computeAveragePaceSeconds,
  durationPartsToSeconds,
  formatDistance,
  durationToInputParts,
  formatPaceSpoken,
  validateDistanceKm,
  validateDurationParts,
  validatePace,
  secondsToPaceParts,
} from "../../domain/pace.ts";
import { pathThroughStops } from "../../domain/pathfinding.ts";
import type { LocalMetersPoint, PlaceRef, RegionId } from "../../domain/models.ts";
import { useApp } from "../../app/context.tsx";
import { parseOptionalNumber } from "./inputs.tsx";

type DistanceSource = "typed" | "map" | "current" | "fixed";

export type CurrentRoutePick = {
  origin: PlaceRef;
  destination: PlaceRef;
  waypoints: PlaceRef[];
};

export function PaceCalculator({
  fixedDistanceKm,
  currentRoute,
  initialTotalSeconds,
  onApply,
  onCancel,
  onSkipPace,
  applyLabel = "이번 러닝에 적용",
}: {
  fixedDistanceKm?: number | null;
  currentRoute?: CurrentRoutePick | null;
  initialTotalSeconds?: number | null;
  onApply: (paceSeconds: number) => void;
  onCancel: () => void;
  onSkipPace?: () => void;
  applyLabel?: string;
}) {
  const ctx = useApp();
  const regionId = (ctx.profile?.regionId ?? "seoul") as RegionId;
  const network = ctx.providers.places.getNetwork(regionId);
  const fixed = fixedDistanceKm && fixedDistanceKm > 0 ? fixedDistanceKm : null;

  const [distanceStr, setDistanceStr] = useState(fixed ? String(fixed) : "");
  const [preciseKm, setPreciseKm] = useState<number | null>(fixed);
  const [source, setSource] = useState<DistanceSource>(fixed ? "fixed" : "typed");
  const preset = initialTotalSeconds && initialTotalSeconds > 0 ? durationToInputParts(initialTotalSeconds) : null;
  const [hours, setHours] = useState(preset?.hours ?? "");
  const [minutes, setMinutes] = useState(preset?.minutes ?? "");
  const [seconds, setSeconds] = useState(preset?.seconds ?? "");
  const [origin, setOrigin] = useState<PlaceRef | null>(currentRoute?.origin ?? null);
  const [destination, setDestination] = useState<PlaceRef | null>(currentRoute?.destination ?? null);
  const [waypoints, setWaypoints] = useState<PlaceRef[]>(currentRoute?.waypoints ?? []);
  const [loop, setLoop] = useState(false);
  const [pick, setPick] = useState<"origin" | "destination">("origin");
  const [pathError, setPathError] = useState<string | null>(null);
  const [pathGeometry, setPathGeometry] = useState<LocalMetersPoint[] | null>(null);
  const [pathLengthM, setPathLengthM] = useState<number | null>(null);

  const distanceKm = fixed ?? preciseKm ?? parseOptionalNumber(distanceStr);
  const hourN = parseOptionalNumber(hours) ?? 0;
  const minN = parseOptionalNumber(minutes) ?? 0;
  const secN = parseOptionalNumber(seconds) ?? 0;
  const typedTime = hours !== "" || minutes !== "" || seconds !== "";
  const distanceError = distanceKm === null ? null : validateDistanceKm(distanceKm);
  const timeError = typedTime ? validateDurationParts(hourN, minN, secN) : null;
  const totalSeconds = typedTime ? durationPartsToSeconds(hourN, minN, secN) : null;
  const paceSeconds =
    distanceError || timeError || distanceKm === null || totalSeconds === null
      ? null
      : computeAveragePaceSeconds(distanceKm, totalSeconds);
  const paceError = paceSeconds === null ? null : validatePace(secondsToPaceParts(paceSeconds));

  const plannedStops = useMemo(() => {
    if (!origin) return [];
    if (loop) return [origin, ...waypoints, origin];
    if (!destination) return [];
    return [origin, ...waypoints, destination];
  }, [origin, destination, waypoints, loop]);

  const applyPlace = (place: PlaceRef) => {
    const nextOrigin = pick === "origin" ? place : origin;
    const nextDest = pick === "destination" ? place : destination;
    if (pick === "origin") setOrigin(place);
    else setDestination(place);
    if (!nextOrigin || !nextDest) return;
    const stops = loop ? [nextOrigin, nextDest, nextOrigin] : [nextOrigin, nextDest];
    usePathDistance("map", stops, loop);
  };

  const resolvePath = (
    stops = plannedStops,
    asLoop = loop,
  ) => {
    const start = stops[0];
    if (!start) {
      setPathError("출발지를 선택해 주세요.");
      setPathGeometry(null);
      setPathLengthM(null);
      return null;
    }
    if (asLoop && stops.length < 3) {
      setPathError("순환 코스는 도착지도 선택해 주세요.");
      setPathGeometry(null);
      setPathLengthM(null);
      return null;
    }
    if (!asLoop && stops.length < 2) {
      setPathError("도착지를 선택해 주세요.");
      setPathGeometry(null);
      setPathLengthM(null);
      return null;
    }
    if (start.nodeId === stops[1]?.nodeId) {
      setPathError("출발과 도착이 같습니다. 다른 도착지를 선택해 주세요.");
      setPathGeometry(null);
      setPathLengthM(null);
      return null;
    }
    const built = pathThroughStops(
      network,
      stops.map((p) => p.nodeId),
    );
    if (!built) {
      setPathError("연결된 보행 경로를 찾지 못했습니다. 경로를 수정하거나 거리를 직접 입력해 주세요.");
      setPathGeometry(null);
      setPathLengthM(null);
      return null;
    }
    setPathError(null);
    setPathGeometry(built.geometry);
    setPathLengthM(built.lengthM);
    return built;
  };

  const usePathDistance = (
    nextSource: DistanceSource,
    stops = plannedStops,
    asLoop = loop,
  ) => {
    const built = resolvePath(stops, asLoop);
    if (!built) {
      if (nextSource === "map" || nextSource === "current") {
        setPreciseKm(null);
        setDistanceStr("");
      }
      return;
    }
    const km = built.lengthM / 1000;
    setPreciseKm(km);
    setDistanceStr(String(Number(km.toFixed(3))));
    setSource(nextSource);
  };

  return (
    <div className="pace-calc">
      <div className="pace-calc-card">
        <div className="pace-calc-row">
          <span>거리</span>
          {fixed ? (
            <span className="pace-calc-fixed">{fixed} km</span>
          ) : (
            <>
              <input
                inputMode="decimal"
                value={distanceStr}
                placeholder="0.0"
                onChange={(e) => {
                  setDistanceStr(e.target.value);
                  setPreciseKm(parseOptionalNumber(e.target.value));
                  setSource("typed");
                }}
              />
              <span className="pace-suffix">km</span>
            </>
          )}
        </div>
        {fixed ? null : (
          <div className="pace-map-check">
            <div className="pace-map-check-head">
              <span>지도로 확인하기</span>
              <div className="pace-calc-tools">
                {currentRoute ? (
                  <button
                    type="button"
                    className="more-link"
                    onClick={() => {
                      setOrigin(currentRoute.origin);
                      setDestination(currentRoute.destination);
                      setWaypoints(currentRoute.waypoints);
                      setLoop(false);
                      usePathDistance(
                        "current",
                        [currentRoute.origin, ...currentRoute.waypoints, currentRoute.destination],
                        false,
                      );
                    }}
                  >
                    현재 경로
                  </button>
                ) : null}
                <button type="button" className="pace-link-btn" disabled>
                  지도 연동 준비 중
                </button>
              </div>
            </div>
            <div className="pace-calc-tools">
              <button
                type="button"
                className="region-chip"
                aria-pressed={pick === "origin"}
                onClick={() => setPick("origin")}
              >
                출발
              </button>
              <button
                type="button"
                className="region-chip"
                aria-pressed={pick === "destination"}
                onClick={() => setPick("destination")}
              >
                도착
              </button>
              <button
                type="button"
                className="region-chip"
                aria-pressed={loop}
                onClick={() => {
                  const next = !loop;
                  setLoop(next);
                  if (origin && destination) {
                    usePathDistance(
                      "map",
                      next ? [origin, destination, origin] : [origin, destination],
                      next,
                    );
                  }
                }}
              >
                순환
              </button>
            </div>
            <div className="pace-calc-map">
              <MapRenderer
                network={network}
                origin={origin}
                destination={destination}
                route={pathGeometry ?? undefined}
                framed
                showBadge={false}
                height={148}
                onSelectPoint={(point) => {
                  applyPlace(
                    ctx.providers.places.fromPoint(
                      regionId,
                      point,
                      pick === "origin" ? "지도에서 고른 출발" : "지도에서 고른 도착",
                    ),
                  );
                }}
              />
            </div>
            <div className="pace-map-meta">
              <span>가상 지도 · 실제 길 안내가 아닙니다</span>
              <span>
                {pathLengthM !== null
                  ? formatDistance(pathLengthM)
                  : pick === "origin"
                    ? "출발을 찍어 주세요"
                    : "도착을 찍어 주세요"}
              </span>
            </div>
            {pathError ? <p className="error">{pathError}</p> : null}
          </div>
        )}
        <div className="pace-calc-row">
          <span>시간</span>
          <input inputMode="numeric" value={hours} placeholder="0" onChange={(e) => setHours(e.target.value)} />
          <span className="pace-suffix">시</span>
          <input inputMode="numeric" value={minutes} placeholder="0" onChange={(e) => setMinutes(e.target.value)} />
          <span className="pace-suffix">분</span>
          <input inputMode="numeric" value={seconds} placeholder="0" onChange={(e) => setSeconds(e.target.value)} />
          <span className="pace-suffix">초</span>
        </div>
      </div>
      <div className="pace-calc-result" aria-live="polite">
        <span className="tiny muted">평균 페이스</span>
        <strong>{paceSeconds !== null && !paceError ? formatPaceSpoken(paceSeconds) : "—"}</strong>
      </div>
      {distanceError ? <p className="error">{distanceError}</p> : null}
      {timeError ? <p className="error">{timeError}</p> : null}
      {paceError ? <p className="error">{paceError}</p> : null}
      <Button
        type="button"
        variant="primary"
        disabled={
          paceSeconds === null ||
          Boolean(paceError) ||
          Boolean(pathError && (source === "map" || source === "current"))
        }
        onClick={() => {
          if (paceSeconds === null || paceError) return;
          if (pathError && (source === "map" || source === "current")) return;
          onApply(paceSeconds);
        }}
      >
        {applyLabel}
      </Button>
      {onSkipPace ? (
        <Button type="button" onClick={onSkipPace}>
          시간을 입력하지 않고, 그냥 달릴래요
        </Button>
      ) : null}
      <Button type="button" onClick={onCancel}>
        취소
      </Button>
    </div>
  );
}
