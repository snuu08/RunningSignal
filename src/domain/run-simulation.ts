import { pointAlongPolyline } from "./geo.ts";
import type { Clock } from "./clock.ts";
import type {
  LocalMetersPoint,
  PathEvaluation,
  PauseReason,
  RunPhase,
  RunTimes,
  RunningSubState,
} from "./models.ts";
import { crossingAtProgress } from "./signals.ts";

export type SimSnapshot = {
  phase: RunPhase;
  runningSub: RunningSubState;
  pauseReason: PauseReason | null;
  progressM: number;
  times: RunTimes;
  simSpeed: 1 | 10 | 30;
  lastTickSec: number;
  waitingUntilSec: number | null;
  startedAtSec: number | null;
};

export class RunSimulator {
  readonly evaluation: PathEvaluation;
  private clock: Clock;
  private paceSecondsPerKm: number;
  phase: RunPhase = "ready";
  runningSub: RunningSubState = "moving";
  pauseReason: PauseReason | null = null;
  progressM = 0;
  times: RunTimes = {
    movingSec: 0,
    signalWaitSec: 0,
    manualPauseSec: 0,
    totalElapsedSec: 0,
  };
  simSpeed: 1 | 10 | 30 = 1;
  private lastTickSec: number | null = null;
  private waitingUntilSec: number | null = null;
  startedAtSec: number | null = null;
  private realPauseStarted: number | null = null;

  constructor(evaluation: PathEvaluation, clock: Clock, paceSecondsPerKm: number) {
    this.evaluation = evaluation;
    this.clock = clock;
    this.paceSecondsPerKm = paceSecondsPerKm;
  }

  get lengthM(): number {
    return this.evaluation.candidate.lengthM;
  }

  position(): LocalMetersPoint {
    return pointAlongPolyline(this.evaluation.candidate.geometry, this.progressM);
  }

  start(): void {
    if (this.phase !== "ready" && this.phase !== "paused") return;
    this.phase = "running";
    this.runningSub = "moving";
    this.pauseReason = null;
    this.startedAtSec = this.startedAtSec ?? this.clock.nowSec();
    this.lastTickSec = this.clock.nowSec();
    this.realPauseStarted = null;
  }

  pause(reason: PauseReason): void {
    if (this.phase !== "running") return;
    this.tick();
    this.phase = "paused";
    this.pauseReason = reason;
    this.lastTickSec = this.clock.nowSec();
    this.realPauseStarted = reason === "manual" ? Date.now() : null;
  }

  resume(): void {
    if (this.phase !== "paused") return;
    if (this.pauseReason === "manual" && this.realPauseStarted !== null) {
      this.times.manualPauseSec += (Date.now() - this.realPauseStarted) / 1000;
    }
    this.realPauseStarted = null;
    this.phase = "running";
    this.pauseReason = null;
    this.lastTickSec = this.clock.nowSec();
  }

  setSpeed(speed: 1 | 10 | 30): void {
    this.tick();
    this.simSpeed = speed;
  }

  finish(partial: boolean): void {
    this.tick();
    this.phase = "completed";
    this.runningSub = "moving";
    this.waitingUntilSec = null;
    if (!partial) this.progressM = this.lengthM;
    this.recomputeTotal();
  }

  tick(): void {
    if (this.phase !== "running") {
      if (this.phase === "paused" && this.pauseReason === "manual" && this.realPauseStarted !== null) {
        const extra = (Date.now() - this.realPauseStarted) / 1000;
        this.recomputeTotal(extra);
      }
      return;
    }
    const now = this.clock.nowSec();
    if (this.lastTickSec === null) {
      this.lastTickSec = now;
      return;
    }
    const dt = Math.max(0, now - this.lastTickSec);
    this.lastTickSec = now;

    if (this.runningSub === "waitingAtSignal" && this.waitingUntilSec !== null) {
      this.times.signalWaitSec += dt;
      if (now + 1e-6 >= this.waitingUntilSec) {
        this.runningSub = "moving";
        this.waitingUntilSec = null;
      }
      this.recomputeTotal();
      return;
    }

    const mPerSec = 1000 / this.paceSecondsPerKm;
    const next = Math.min(this.lengthM, this.progressM + dt * mPerSec);
    const moved = next - this.progressM;
    this.times.movingSec += moved <= 0 ? 0 : moved / mPerSec;
    this.progressM = next;

    const hit = crossingAtProgress(this.evaluation, this.progressM);
    if (hit && hit.wait.kind === "exact" && hit.wait.seconds > 0) {
      const already = this.times.signalWaitSec;
      const planned = hit.wait.seconds;
      if (already < planned - 0.05 && this.progressM >= this.lengthAlongTo(hit.directedEdgeId) - 0.8) {
        this.runningSub = "waitingAtSignal";
        this.waitingUntilSec = now + Math.max(0, planned - alreadyForCrossing(this, hit.directedEdgeId));
      }
    }

    if (this.progressM >= this.lengthM - 1e-6) {
      this.progressM = this.lengthM;
      this.phase = "completed";
      this.runningSub = "moving";
    }
    this.recomputeTotal();
  }

  private lengthAlongTo(directedEdgeId: string): number {
    let acc = 0;
    for (const edge of this.evaluation.candidate.directedEdges) {
      acc += edge.lengthM;
      if (edge.directedEdgeId === directedEdgeId) return acc;
    }
    return acc;
  }

  private recomputeTotal(manualExtra = 0): void {
    let manual = this.times.manualPauseSec + manualExtra;
    if (this.phase === "paused" && this.pauseReason === "manual" && this.realPauseStarted !== null) {
      manual = this.times.manualPauseSec + (Date.now() - this.realPauseStarted) / 1000;
    }
    this.times.totalElapsedSec =
      this.times.movingSec + this.times.signalWaitSec + manual;
  }

  snapshot(): SimSnapshot {
    return {
      phase: this.phase,
      runningSub: this.runningSub,
      pauseReason: this.pauseReason,
      progressM: this.progressM,
      times: { ...this.times },
      simSpeed: this.simSpeed,
      lastTickSec: this.lastTickSec ?? 0,
      waitingUntilSec: this.waitingUntilSec,
      startedAtSec: this.startedAtSec,
    };
  }

  restore(snapshot: SimSnapshot): void {
    this.phase = snapshot.phase === "running" ? "paused" : snapshot.phase;
    this.runningSub = snapshot.runningSub;
    this.pauseReason = snapshot.phase === "running" ? "restored" : snapshot.pauseReason;
    this.progressM = snapshot.progressM;
    this.times = { ...snapshot.times };
    this.simSpeed = snapshot.simSpeed;
    this.lastTickSec = snapshot.lastTickSec;
    this.waitingUntilSec = snapshot.waitingUntilSec;
    this.startedAtSec = snapshot.startedAtSec;
    this.realPauseStarted = null;
  }
}

function alreadyForCrossing(sim: RunSimulator, _directedEdgeId: string): number {
  return sim.times.signalWaitSec;
}
