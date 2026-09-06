export type Clock = {
  nowSec(): number;
};

export function realClock(): Clock {
  return {
    nowSec() {
      return Date.now() / 1000;
    },
  };
}

export function fixedClock(sec: number): Clock {
  return {
    nowSec() {
      return sec;
    },
  };
}

export class DemoSimClock implements Clock {
  private originRealMs: number;
  private originSimSec: number;
  private speed: number;
  private frozenSec: number | null;

  constructor(startSec = 0, speed = 1) {
    this.originRealMs = Date.now();
    this.originSimSec = startSec;
    this.speed = speed;
    this.frozenSec = null;
  }

  nowSec(): number {
    if (this.frozenSec !== null) return this.frozenSec;
    const elapsed = (Date.now() - this.originRealMs) / 1000;
    return this.originSimSec + elapsed * this.speed;
  }

  setSpeed(speed: number): void {
    const current = this.nowSec();
    this.originSimSec = current;
    this.originRealMs = Date.now();
    this.speed = speed;
    if (this.frozenSec !== null) this.frozenSec = current;
  }

  getSpeed(): number {
    return this.speed;
  }

  freeze(): void {
    this.frozenSec = this.nowSec();
  }

  unfreeze(): void {
    if (this.frozenSec === null) return;
    this.originSimSec = this.frozenSec;
    this.originRealMs = Date.now();
    this.frozenSec = null;
  }

  isFrozen(): boolean {
    return this.frozenSec !== null;
  }

  snapshot(): { originSimSec: number; speed: number; frozen: boolean; now: number } {
    return {
      originSimSec: this.nowSec(),
      speed: this.speed,
      frozen: this.frozenSec !== null,
      now: this.nowSec(),
    };
  }

  static restore(nowSec: number, speed: number): DemoSimClock {
    const clock = new DemoSimClock(nowSec, speed);
    clock.freeze();
    return clock;
  }
}
