import { GENTLE_TURN_DEG, SHARP_TURN_DEG, ZIGZAG_WINDOW_M } from "../config/app.ts";
import { angleDeltaDeg, headingDeg, localDistance } from "./geo.ts";
import type { LocalMetersPoint } from "./models.ts";

export type TurnMetrics = {
  sharpTurns: number;
  gentleTurns: number;
  zigzagPairs: number;
  turnScore: number;
};

function significantVertices(points: LocalMetersPoint[]): LocalMetersPoint[] {
  if (points.length <= 2) return points;
  const out: LocalMetersPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = out[out.length - 1];
    const cur = points[i];
    const next = points[i + 1];
    if (localDistance(prev, cur) < 8) continue;
    const delta = Math.abs(angleDeltaDeg(headingDeg(prev, cur), headingDeg(cur, next)));
    if (delta < 6) continue;
    out.push(cur);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function evaluateTurns(geometry: LocalMetersPoint[]): TurnMetrics {
  const verts = significantVertices(geometry);
  let sharpTurns = 0;
  let gentleTurns = 0;
  const signed: { delta: number; dist: number }[] = [];
  let traveled = 0;

  for (let i = 1; i < verts.length - 1; i += 1) {
    traveled += localDistance(verts[i - 1], verts[i]);
    const delta = angleDeltaDeg(
      headingDeg(verts[i - 1], verts[i]),
      headingDeg(verts[i], verts[i + 1]),
    );
    const abs = Math.abs(delta);
    if (abs >= SHARP_TURN_DEG) {
      sharpTurns += 1;
      signed.push({ delta, dist: traveled });
    } else if (abs >= GENTLE_TURN_DEG) {
      gentleTurns += 1;
    }
  }

  let zigzagPairs = 0;
  for (let i = 1; i < signed.length; i += 1) {
    const a = signed[i - 1];
    const b = signed[i];
    const opposite = a.delta * b.delta < 0;
    const close = b.dist - a.dist <= ZIGZAG_WINDOW_M;
    if (opposite && close) zigzagPairs += 1;
  }

  const turnScore =
    1 /
    (1 + sharpTurns * 1.15 + zigzagPairs * 1.6 + gentleTurns * 0.12);

  return { sharpTurns, gentleTurns, zigzagPairs, turnScore };
}
