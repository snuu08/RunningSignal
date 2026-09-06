import { useEffect, useRef, useState } from "react";
import { useApp } from "../../app/context.tsx";
import {
  requestWakeLock,
  speakGuidance,
  stopGuidanceSpeech,
  tryVibrate,
  wakeLockSupported,
} from "../../domain/device.ts";
import type { RunPhase } from "../../domain/models.ts";

export function useRunAids(
  phase: RunPhase,
  nextCrossingId: string | null,
  nextCrossingLabel: string | null,
  nextCrossingM: number | null,
): { wakeRequested: boolean; wakeApplied: boolean } {
  const { settings } = useApp();
  const lockRef = useRef<WakeLockSentinel | null>(null);
  const spokenRef = useRef<string | null>(null);
  const vibeRef = useRef<string | null>(null);
  const [wakeApplied, setWakeApplied] = useState(false);

  useEffect(() => {
    const running = phase === "running";
    if (!running) {
      stopGuidanceSpeech();
      void lockRef.current?.release();
      lockRef.current = null;
      setWakeApplied(false);
      return;
    }
    if (settings.keepScreenOn && wakeLockSupported()) {
      void requestWakeLock().then((lock) => {
        lockRef.current = lock;
        setWakeApplied(Boolean(lock));
      });
    }
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (phase !== "running" || !settings.keepScreenOn) return;
      void requestWakeLock().then((lock) => {
        lockRef.current = lock;
        setWakeApplied(Boolean(lock));
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      stopGuidanceSpeech();
      void lockRef.current?.release();
      lockRef.current = null;
    };
  }, [phase, settings.keepScreenOn]);

  useEffect(() => {
    if (phase !== "running") return;
    if (settings.voiceGuidance && nextCrossingId && nextCrossingLabel && spokenRef.current !== nextCrossingId) {
      spokenRef.current = nextCrossingId;
      const dist = nextCrossingM !== null ? `, ${Math.round(nextCrossingM)}미터` : "";
      speakGuidance(`다음 횡단보도, ${nextCrossingLabel}${dist}`);
    }
    if (
      settings.vibrationGuidance &&
      nextCrossingId &&
      nextCrossingM !== null &&
      nextCrossingM < 40 &&
      vibeRef.current !== nextCrossingId
    ) {
      vibeRef.current = nextCrossingId;
      tryVibrate(40);
    }
  }, [phase, nextCrossingId, nextCrossingLabel, nextCrossingM, settings.voiceGuidance, settings.vibrationGuidance]);

  return { wakeRequested: settings.keepScreenOn, wakeApplied };
}
