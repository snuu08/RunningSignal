import { useState } from "react";
import { saveProfile, useApp } from "../../app/context.tsx";
import { Sheet } from "../../components/Sheet.tsx";
import { emptyPaceBook, formatDistance, formatPaceSpoken } from "../../domain/pace.ts";
import { PaceCalculator } from "./PaceCalculator.tsx";

export function saveUsualPaceToAccount(
  ctx: ReturnType<typeof useApp>,
  paceSeconds: number,
): string | null {
  const current = ctx.profile?.paces ?? emptyPaceBook();
  return saveProfile(ctx, {
    paces: {
      ...current,
      usual: paceSeconds,
    },
  });
}

export function RouteDistancePaceSheet({
  distanceM,
  routeId,
  initialTotalSeconds,
  onClose,
}: {
  distanceM: number;
  routeId?: string | null;
  initialTotalSeconds?: number | null;
  onClose: () => void;
}) {
  const ctx = useApp();
  const usual = ctx.profile?.paces.usual ?? null;
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet title="평균 페이스 계정에 저장" onClose={onClose}>
      <p className="tiny muted">
        경로 {formatDistance(distanceM)} 기준 · 평소 러닝 페이스로 저장
        {usual ? ` · 현재 ${formatPaceSpoken(usual)}` : ""}
      </p>
      <PaceCalculator
        applyLabel="내 페이스에 저장"
        fixedDistanceKm={distanceM / 1000}
        initialTotalSeconds={initialTotalSeconds}
        onCancel={onClose}
        onApply={(paceSeconds) => {
          const err = saveUsualPaceToAccount(ctx, paceSeconds);
          if (err) {
            setError(err);
            return;
          }
          if (ctx.account && routeId) {
            ctx.providers.runs.setRouteAveragePace(ctx.account.id, routeId, paceSeconds);
            ctx.refresh();
          }
          onClose();
        }}
      />
      {error ? <p className="error">{error}</p> : null}
    </Sheet>
  );
}
