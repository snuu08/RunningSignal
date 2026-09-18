import { describe, expect, it } from "vitest";
import {
  SIGNAL_DEMO_ROUTE,
  SIGNAL_DEMO_GREEN_HOLD_SEC,
  SIGNAL_DEMO_PACE_SEC_PER_KM,
  demoRunnerState,
  demoSignalPoints,
  demoSignalPredictions,
} from "./signal-demo.ts";
import { pathLength } from "./core.ts";

describe("signal demo prototype", () => {
  it("keeps prediction mode separate from real signal data", () => {
    const [first] = demoSignalPredictions(75, SIGNAL_DEMO_PACE_SEC_PER_KM);
    expect(first).toMatchObject({
      signalId: "demo-01",
      predictionMode: "demo",
      predictedState: "green",
      waitSec: 0,
    });
  });

  it("uses the fixed 6 minute pace and never returns false zero during red", () => {
    expect(SIGNAL_DEMO_PACE_SEC_PER_KM).toBe(360);
    const [first] = demoSignalPredictions(0, SIGNAL_DEMO_PACE_SEC_PER_KM);
    expect(first.predictedState).toBe("red");
    expect(first.waitSec).toBeGreaterThan(0);
  });

  it("turns the next four signals green in route order", () => {
    const checkpoints = [75, 195, 340, 485];
    const greenIds = checkpoints.map(
      (progress) =>
        demoSignalPredictions(progress, 360).find(
          (p) => p.predictedState === "green" && p.atM > progress,
        )?.signalId,
    );
    expect(greenIds).toEqual(["demo-01", "demo-02", "demo-03", "demo-04"]);
  });

  it("keeps each green highlight visible for at least two demo seconds", () => {
    const demoDurationSec = 38;
    const routeSpeedMps = pathLength(SIGNAL_DEMO_ROUTE.coordinates) / demoDurationSec;
    const firstSignal = demoSignalPredictions(75, SIGNAL_DEMO_PACE_SEC_PER_KM)[0];
    const greenWindowM =
      ((firstSignal.greenEndSec - firstSignal.greenStartSec) /
        SIGNAL_DEMO_PACE_SEC_PER_KM) *
      1000;
    expect(greenWindowM / routeSpeedMps).toBeGreaterThanOrEqual(
      SIGNAL_DEMO_GREEN_HOLD_SEC,
    );
  });

  it("moves the runner along the route with heading", () => {
    const runner = demoRunnerState(SIGNAL_DEMO_ROUTE, 120);
    expect(runner.coord).not.toEqual(SIGNAL_DEMO_ROUTE.coordinates[0]);
    expect(runner.heading).toBeGreaterThanOrEqual(0);
    expect(runner.heading).toBeLessThan(360);
  });

  it("marks passed, next, and green signal map points distinctly", () => {
    const predictions = demoSignalPredictions(195, 360);
    const points = demoSignalPoints(195, predictions);
    expect(points.some((p) => p.kind === "demo-signal-past")).toBe(true);
    expect(points.some((p) => p.kind === "demo-signal-green")).toBe(true);
  });
});
