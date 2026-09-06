import { localDistance, localPoint, pointAlongPolyline, polylineLength } from "./geo.ts";
import { elapsedPace } from "./pace.ts";
import type {
  JustRunSummary,
  LocalMetersPoint,
  PathEvaluation,
  PauseReason,
  PlaceRef,
  RegionId,
  RouteRequest,
  RunPhase,
  RunTimes,
} from "./models.ts";

const SAMPLE_EVERY_M = 8;
const LAP_NEAR_M = 16;
const LAP_FAR_M = 36;

export type JustRunSnapshot = {
  phase: RunPhase;
  pauseReason: PauseReason | null;
  progressM: number;
  times: RunTimes;
  startedAtSec: number | null;
  track: LocalMetersPoint[];
};

export class JustRunTracker {
  phase: RunPhase = "ready";
  pauseReason: PauseReason | null = null;
  progressM = 0;
  times: RunTimes = {
    movingSec: 0,
    signalWaitSec: 0,
    manualPauseSec: 0,
    totalElapsedSec: 0,
  };
  startedAtSec: number | null = null;
  track: LocalMetersPoint[] = [];
  private lastTickMs: number | null = null;
  private alongM = 0;
  private lastSampleM = 0;
  private readonly loop: LocalMetersPoint[];
  private readonly lapM: number;
  private readonly paceSecondsPerKm: number;

  constructor(paceSecondsPerKm: number, center: LocalMetersPoint) {
    this.paceSecondsPerKm = paceSecondsPerKm;
    this.loop = justRunLoopGeometry(center);
    this.lapM = polylineLength(this.loop);
    this.track = [this.loop[0]];
  }

  start(nowMs = Date.now()): void {
    if (this.phase !== "ready" && this.phase !== "paused") return;
    this.phase = "running";
    this.pauseReason = null;
    this.startedAtSec = this.startedAtSec ?? nowMs / 1000;
    this.lastTickMs = nowMs;
  }

  pause(reason: PauseReason, nowMs = Date.now()): void {
    if (this.phase !== "running") return;
    this.tick(nowMs);
    this.phase = "paused";
    this.pauseReason = reason;
    this.lastTickMs = nowMs;
  }

  resume(nowMs = Date.now()): void {
    if (this.phase !== "paused") return;
    this.phase = "running";
    this.pauseReason = null;
    this.lastTickMs = nowMs;
  }

  finish(nowMs = Date.now()): JustRunSummary {
    if (this.phase === "running") this.tick(nowMs);
    this.phase = "completed";
    this.lastTickMs = nowMs;
    return summarizeJustRun(this.track, this.times.totalElapsedSec);
  }

  tick(nowMs = Date.now()): void {
    if (this.phase !== "running" || this.lastTickMs === null) return;
    const dt = Math.max(0, (nowMs - this.lastTickMs) / 1000);
    this.lastTickMs = nowMs;
    this.times.movingSec += dt;
    this.times.totalElapsedSec += dt;
    if (this.paceSecondsPerKm <= 0 || this.lapM <= 0) return;
    const moved = (1000 / this.paceSecondsPerKm) * dt;
    this.alongM += moved;
    this.progressM = this.alongM;
    if (this.alongM - this.lastSampleM < SAMPLE_EVERY_M) return;
    this.lastSampleM = this.alongM;
    this.track.push(pointAlongPolyline(this.loop, this.alongM % this.lapM));
  }

  snapshot(): JustRunSnapshot {
    return {
      phase: this.phase,
      pauseReason: this.pauseReason,
      progressM: this.progressM,
      times: { ...this.times },
      startedAtSec: this.startedAtSec,
      track: this.track,
    };
  }
}

export function justRunLoopGeometry(center: LocalMetersPoint, radiusM = 70): LocalMetersPoint[] {
  const steps = 16;
  const points: LocalMetersPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    points.push(localPoint(center.x + Math.cos(angle) * radiusM, center.y + Math.sin(angle) * radiusM));
  }
  return points;
}

export function countLaps(
  track: LocalMetersPoint[],
  start: LocalMetersPoint,
  nearM = LAP_NEAR_M,
  farM = LAP_FAR_M,
): number {
  let away = false;
  let laps = 0;
  for (const point of track) {
    const d = localDistance(point, start);
    if (!away && d >= farM) away = true;
    if (away && d <= nearM) {
      laps += 1;
      away = false;
    }
  }
  return laps;
}

export function summarizeJustRun(track: LocalMetersPoint[], totalSec: number): JustRunSummary {
  const distanceM = track.length > 1 ? polylineLength(track) : 0;
  const laps = track[0] ? countLaps(track, track[0]) : 0;
  const pace = distanceM > 0 && totalSec > 0 ? elapsedPace(totalSec, distanceM) : null;
  return {
    distanceM,
    laps,
    paceSeconds: pace && pace > 0 ? Math.round(pace) : null,
  };
}

export function justRunFingerprint(regionId: RegionId): string {
  return `just-run:${regionId}`;
}

export function buildJustRunPlan(
  start: PlaceRef,
  paceSecondsPerKm: number,
  regionId: RegionId,
  track: LocalMetersPoint[],
  distanceM: number,
): { request: RouteRequest; evaluation: PathEvaluation } {
  const geometry = track.length > 1 ? track : justRunLoopGeometry(start.point);
  const request: RouteRequest = {
    origin: start,
    destination: start,
    waypoints: [],
    paceSecondsPerKm,
    departure: { kind: "clock-start", atSec: 0 },
    seed: 0,
    nowSec: 0,
  };
  const evaluation: PathEvaluation = {
    candidate: {
      id: justRunFingerprint(regionId),
      directedEdges: [],
      nodeIds: [start.nodeId],
      lengthM: distanceM,
      geometry,
      fingerprint: justRunFingerprint(regionId),
      viaLabel: "Just RUN!",
    },
    travelSec: { kind: "unknown" },
    waitSec: { kind: "exact", seconds: 0 },
    totalSec: { kind: "unknown" },
    stopCount: 0,
    signalCrossingCount: 0,
    knownCrossingCount: 0,
    unknownCrossingCount: 0,
    crossings: [],
    turnScore: 0,
    walkScore: 0,
    sharpTurns: 0,
    zigzagPairs: 0,
    maxExactWaitSec: 0,
    complete: false,
    paceAvailable: true,
    signalComparisonReady: false,
  };
  return { request, evaluation };
}
