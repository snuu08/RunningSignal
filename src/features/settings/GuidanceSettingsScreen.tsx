import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { saveSettings, useApp } from "../../app/context.tsx";
import { AppHeader } from "../../components/chrome.tsx";
import { speechSupported, vibrateSupported, wakeLockSupported } from "../../domain/device.ts";
import { SettingsGroup, SettingsToggleRow } from "./rows.tsx";

export function GuidanceSettingsScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const voiceOk = speechSupported();
  const vibeOk = vibrateSupported();
  const wakeOk = wakeLockSupported();

  const apply = (patch: Parameters<typeof saveSettings>[1]) => {
    setError(saveSettings(ctx, patch));
  };

  return (
    <div className="app-page">
      <AppHeader title="지도·러닝 안내" onBack={() => navigate("/settings")} centerTitle />
      <div className="page-body stack" style={{ paddingTop: 8 }}>
        <p className="tiny muted">지도 표시만 바꿉니다. 경로 추천 계산에서 신호를 끄지 않습니다.</p>
        {error ? <p className="error">{error}</p> : null}

        <SettingsGroup title="지도">
          <SettingsToggleRow
            title="경로 위 보행신호 표시"
            value="선택한 경로가 이용하는 신호"
            checked={ctx.settings.showRouteSignals}
            onChange={(next) => apply({ showRouteSignals: next })}
          />
          <SettingsToggleRow
            title="주변 신호 표시"
            value="데이터가 있는 위치만"
            checked={ctx.settings.showNearbySignals}
            onChange={(next) => apply({ showNearbySignals: next })}
          />
        </SettingsGroup>

        {voiceOk || vibeOk || wakeOk ? (
          <SettingsGroup title="러닝 중 안내">
            {voiceOk ? (
              <SettingsToggleRow
                title="음성 안내"
                value="방향·다음 횡단보도"
                checked={ctx.settings.voiceGuidance}
                onChange={(next) => apply({ voiceGuidance: next })}
              />
            ) : null}
            {vibeOk ? (
              <SettingsToggleRow
                title="진동 안내"
                value="다음 횡단 접근 시"
                checked={ctx.settings.vibrationGuidance}
                onChange={(next) => apply({ vibrationGuidance: next })}
              />
            ) : null}
            {wakeOk ? (
              <SettingsToggleRow
                title="화면 켜짐 유지"
                value="러닝 중에만 요청"
                checked={ctx.settings.keepScreenOn}
                onChange={(next) => apply({ keepScreenOn: next })}
              />
            ) : null}
          </SettingsGroup>
        ) : (
          <p className="tiny muted">이 환경에서는 음성·진동·화면 유지 기능을 켤 수 없습니다.</p>
        )}
        <p className="tiny muted">예측 신호를 근거로 지금 건너라거나 가속하라는 안내는 하지 않습니다.</p>
      </div>
    </div>
  );
}
