import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { saveSettings, useApp } from "../../app/context.tsx";
import { AppHeader } from "../../components/chrome.tsx";
import type { DetourAllowance, RecommendStyle } from "../../domain/models.ts";
import { detourPreset, recommendStyleLabel, detourAllowanceLabel } from "../../domain/settings.ts";
import { SettingsGroup, SettingsToggleRow } from "./rows.tsx";

function ChoiceRow({
  title,
  selected,
  onSelect,
}: {
  title: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className="settings-row" aria-pressed={selected} onClick={onSelect}>
      <span>{title}</span>
      <span className="tiny muted">{selected ? "선택됨" : ""}</span>
    </button>
  );
}

export function RoutingSettingsScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const preset = detourPreset(ctx.settings.detourAllowance);

  const apply = (patch: Parameters<typeof saveSettings>[1]) => {
    const err = saveSettings(ctx, patch);
    setError(err);
  };

  return (
    <div className="app-page">
      <AppHeader title="경로 추천" onBack={() => navigate("/settings")} centerTitle />
      <div className="page-body stack" style={{ paddingTop: 8 }}>
        <p className="tiny muted">다음 경로 검색부터 적용됩니다. 지금 달리는 경로는 바꾸지 않습니다.</p>
        {error ? <p className="error">{error}</p> : null}

        <SettingsGroup title="추천 성향">
          <ChoiceRow
            title={recommendStyleLabel("balanced")}
            selected={ctx.settings.recommendStyle === "balanced"}
            onSelect={() => apply({ recommendStyle: "balanced" satisfies RecommendStyle })}
          />
          <ChoiceRow
            title={recommendStyleLabel("min-stops")}
            selected={ctx.settings.recommendStyle === "min-stops"}
            onSelect={() => apply({ recommendStyle: "min-stops" })}
          />
        </SettingsGroup>
        <p className="tiny muted">
          멈춤 최소는 우회 한도 안에서 정지 횟수와 총 대기를 먼저 봅니다. 거리와 멈춤 균형은 멈춤을 조금
          줄이려고 멀리 돌아가는 길을 억제합니다.
        </p>

        <SettingsGroup title="우회 허용 범위">
          {(["tight", "normal", "generous"] as DetourAllowance[]).map((id) => (
            <ChoiceRow
              key={id}
              title={detourAllowanceLabel(id)}
              selected={ctx.settings.detourAllowance === id}
              onSelect={() => apply({ detourAllowance: id })}
            />
          ))}
        </SettingsGroup>
        <p className="tiny muted">신호 대기를 줄이기 위해 조금 더 달리는 것을 허용해요.</p>
        <button type="button" className="settings-row" onClick={() => setAdvanced((v) => !v)}>
          <span>고급 설정</span>
          <span className="tiny muted">{advanced ? "접기" : "보기"}</span>
        </button>
        {advanced ? (
          <p className="tiny muted">
            현재 허용 추가 거리는 기준 거리의 {Math.round(preset.ratio * 100)}%와 {preset.maxM}m 중 더 작은
            값입니다. 두 제한을 모두 만족해야 합니다.
          </p>
        ) : null}

        <SettingsGroup title="계단·육교">
          <SettingsToggleRow
            title="가능하면 계단 피하기"
            checked={ctx.settings.avoidStairs}
            onChange={(next) => apply({ avoidStairs: next })}
          />
          <SettingsToggleRow
            title="가능하면 육교 피하기"
            checked={ctx.settings.avoidOverpass}
            onChange={(next) => apply({ avoidOverpass: next })}
          />
        </SettingsGroup>
        <p className="tiny muted">
          절대 금지가 아닙니다. 다른 길이 없으면 포함할 수 있고, 그때는 추천 결과에 표시합니다. 보행할 수
          없는 구간은 허용하지 않습니다.
        </p>
      </div>
    </div>
  );
}
