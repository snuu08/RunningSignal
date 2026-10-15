import { useEffect, useRef, useState } from "react";
import { api } from "./backend.ts";
import type { RoutesEvaluationResponse } from "./api-contract.ts";
import type { Route } from "./core.ts";

export function evaluationCandidate(route: Route, traveledM = 0) {
  return {
    route: {
      id: route.id, name: route.name, coordinates: route.coordinates,
      distanceM: route.distanceM, option: route.option,
    },
    traveledM: Math.max(0, Math.min(route.distanceM, traveledM)),
  };
}

/** Refresh local verified signal plans without requesting TMAP routes every tick. */
export function useLiveRouteForecast(input: {
  runId: string | null;
  route: Route | null;
  running: boolean;
  enabled: boolean;
  pace: number;
  traveledM: number;
}) {
  const latest = useRef(input);
  latest.current = input;
  const [assessment, setAssessment] = useState<RoutesEvaluationResponse | null>(null);
  const [error, setError] = useState("");
  const { route, runId, running, enabled } = input;
  useEffect(() => {
    setAssessment(null);
    setError("");
    if (!route || !runId || !running || !enabled) return;
    let disposed = false;
    let pending = false;
    let request: AbortController | null = null;
    async function refresh() {
      if (pending || disposed) return;
      const current = latest.current;
      if (!current.route) return;
      pending = true;
      request = new AbortController();
      try {
        const result = await api<RoutesEvaluationResponse>("routes/evaluate", {
          candidates: [evaluationCandidate(current.route, current.traveledM)],
          pace: current.pace,
        }, request.signal);
        if (!disposed) {
          setAssessment(result);
          setError("");
        }
      } catch {
        if (!disposed) {
          setAssessment(null);
          setError("신호 재계산을 확인하지 못했어요. 다음 갱신에서 다시 확인합니다.");
        }
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => {
      disposed = true;
      request?.abort();
      window.clearInterval(timer);
    };
  }, [route, runId, running, enabled]);
  return { assessment, error };
}
