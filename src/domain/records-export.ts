import type { RunSession, SavedRoute } from "./models.ts";
import { elapsedPace, movingPace } from "./pace.ts";

export type RecordPaceChoice = {
  sessionId: string;
  routeId: string | null;
  title: string;
  createdAt: number;
  source: "demo" | "real";
  distanceM: number;
  movingPaceSeconds: number | null;
  overallPaceSeconds: number | null;
};

export function pacesFromSession(
  session: RunSession,
  routeLengthM?: number,
): { movingPaceSeconds: number | null; overallPaceSeconds: number | null; distanceM: number } {
  const distanceM = session.progressM > 0 ? session.progressM : routeLengthM ?? 0;
  const moving =
    session.times.movingSec > 0 && distanceM > 0 ? movingPace(session.times.movingSec, distanceM) : null;
  const overall =
    session.times.totalElapsedSec > 0 && distanceM > 0
      ? elapsedPace(session.times.totalElapsedSec, distanceM)
      : null;
  return {
    movingPaceSeconds: moving && moving > 0 ? Math.round(moving) : null,
    overallPaceSeconds: overall && overall > 0 ? Math.round(overall) : null,
    distanceM,
  };
}

export function recordPaceChoices(
  sessions: RunSession[],
  routes: SavedRoute[],
): RecordPaceChoice[] {
  const byId = new Map(routes.map((route) => [route.routeId, route]));
  return sessions
    .map((session) => {
      const route = session.routeId ? byId.get(session.routeId) : undefined;
      const paces = pacesFromSession(session, route?.lengthM);
      return {
        sessionId: session.sessionId,
        routeId: session.routeId,
        title: session.title || route?.title || "러닝",
        createdAt: session.createdAt,
        source: session.source,
        ...paces,
      };
    })
    .filter((row) => row.movingPaceSeconds !== null || row.overallPaceSeconds !== null);
}

export function exportRunRecords(accountId: string, routes: SavedRoute[], sessions: RunSession[]) {
  return {
    exportedAt: new Date().toISOString(),
    accountId,
    units: {
      distance: "meters",
      time: "seconds",
      pace: "seconds_per_km",
      date: "unix_ms",
    },
    records: sessions.map((session) => {
      const route = session.routeId ? routes.find((item) => item.routeId === session.routeId) : undefined;
      const paces = pacesFromSession(session, route?.lengthM);
      return {
        sessionId: session.sessionId,
        title: session.title,
        source: session.source,
        createdAt: session.createdAt,
        distanceM: paces.distanceM,
        movingSec: session.times.movingSec,
        signalWaitSec: session.times.signalWaitSec,
        totalElapsedSec: session.times.totalElapsedSec,
        movingPaceSecondsPerKm: paces.movingPaceSeconds,
        overallPaceSecondsPerKm: paces.overallPaceSeconds,
      };
    }),
  };
}

export function downloadJson(filename: string, data: unknown): boolean {
  if (typeof document === "undefined") return false;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
