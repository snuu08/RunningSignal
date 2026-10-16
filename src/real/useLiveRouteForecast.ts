import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "./backend.ts";
import type { RoutesEvaluationResponse } from "./api-contract.ts";
import type { Route } from "./core.ts";

const pageIsHidden = () => document.visibilityState === "hidden";

export function evaluationCandidate(route: Route, traveledM = 0) {
  return {
    route: {
      id: route.id, name: route.name, coordinates: route.coordinates,
      distanceM: route.distanceM, option: route.option,
    },
    traveledM: Math.max(0, Math.min(route.distanceM, traveledM)),
  };
}

/** Refresh source observations with current GPS pace/progress; respect quota backoff. */
export function useLiveRouteForecast(input: {
  runId: string | null;
  route: Route | null;
  running: boolean;
  enabled: boolean;
  pace: number;
  traveledM: number;
}) {
  const latest = useRef(input);
  const backoffUntilMs = useRef(0);
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
    let timer: number | undefined;
    function schedule(delayMs: number) {
      if (!disposed && !pageIsHidden())
        timer = window.setTimeout(() => void refresh(), Math.min(2_147_483_647, Math.max(5000, delayMs)));
    }
    async function refresh() {
      if (pending || disposed || pageIsHidden()) return;
      if (Date.now() < backoffUntilMs.current) {
        schedule(backoffUntilMs.current - Date.now());
        return;
      }
      const current = latest.current;
      if (!current.route) return;
      pending = true;
      request = new AbortController();
      let delayMs = 5000;
      try {
        const result = await api<RoutesEvaluationResponse>("routes/evaluate", {
          candidates: [evaluationCandidate(current.route, current.traveledM)],
          pace: current.pace,
        }, request.signal);
        if (!disposed && !pageIsHidden()) {
          setAssessment(result);
          setError("");
        }
        if (Number.isFinite(result.refreshAfterMs)) delayMs = Math.max(delayMs, result.refreshAfterMs!);
      } catch (error) {
        if (error instanceof ApiRequestError && error.retryAfterMs !== null)
          delayMs = Math.max(delayMs, error.retryAfterMs);
        if (!disposed) {
          setAssessment(null);
          setError("신호 재계산을 확인하지 못했어요. 다음 갱신에서 다시 확인합니다.");
        }
      } finally {
        pending = false;
        if (delayMs > 5000) backoffUntilMs.current = Math.max(backoffUntilMs.current, Date.now() + delayMs);
        schedule(delayMs);
      }
    }
    function visibilityChanged() {
      window.clearTimeout(timer);
      setAssessment(null);
      if (!pageIsHidden()) void refresh();
    }
    void refresh();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      disposed = true;
      request?.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [route, runId, running, enabled]);
  return { assessment, error };
}
