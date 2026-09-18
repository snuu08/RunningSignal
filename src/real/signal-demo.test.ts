import { describe, expect, it } from "vitest";
import {
  SIGNAL_DEMO_ROUTE,
  demoRunnerState,
  demoSignalPoints,
  demoSignalPredictions,
} from "./signal-demo.ts";

describe("signal demo prototype", () => {
  it("keeps prediction mode separate from real signal data", () => {
    const [first] = demoSignalPredictions(75, 360);
    expect(first).toMatchObject({
      signalId: "demo-01",
      predictionMode: "demo",
      predictedState: "green",
      waitSec: 0,
    });
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
