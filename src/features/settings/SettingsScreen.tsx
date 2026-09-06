import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { saveProfile, useApp } from "../../app/context.tsx";
import { AppHeader, BottomNav } from "../../components/chrome.tsx";
import { Button } from "../../components/ui.tsx";
import { demoCapabilityStatuses, isDemoMode } from "../../config/mode.ts";
import { REGIONS } from "../../data/demo/regions.ts";
import type { RegionId } from "../../domain/models.ts";

export function SettingsScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="app-page">
      <AppHeader />
      <div className="page-body has-tab stack" style={{ paddingTop: 8 }}>
        <h1 className="h1">설정</h1>
        {ctx.storeError ? (
          <div className="card">
            {ctx.storeError}
            <Button variant="secondary" onClick={() => ctx.store.resetAppData()}>
              앱 데이터만 복구 초기화
            </Button>
          </div>
        ) : null}
        <div className="settings-row">
          <span>닉네임</span>
          <span className="tiny muted">{ctx.profile?.nickname ?? "—"}</span>
        </div>
        <button type="button" className="settings-row" onClick={() => navigate("/settings/paces")}>
          <span>내 러닝 페이스</span>
          <span className="tiny muted">관리</span>
        </button>
        <div className="settings-region">
          <span className="tiny muted">지역</span>
          <div className="region-chips" role="group" aria-label="지역">
            {REGIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                className="region-chip"
                aria-pressed={ctx.profile?.regionId === r.id}
                onClick={() => saveProfile(ctx, { regionId: r.id as RegionId })}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="tiny muted" style={{ marginTop: 16 }}>
          연결 준비 상태
        </div>
        {demoCapabilityStatuses().map((c) => (
          <div key={c.area} className="settings-row">
            <span>{c.area}</span>
            <span className="tiny muted">
              {c.mode} · {c.detail}
            </span>
          </div>
        ))}
        {isDemoMode() ? (
          <button className="settings-row" onClick={() => navigate("/inbox")}>
            데모 수신함
          </button>
        ) : null}
        <button
          className="settings-row"
          onClick={() => {
            ctx.providers.auth.logout();
            ctx.refresh();
            navigate("/");
          }}
        >
          로그아웃
        </button>
        <button className="settings-row" onClick={() => setConfirmReset(true)}>
          데모 데이터 초기화
        </button>
        {confirmReset ? (
          <div className="stack">
            <p className="tiny muted">앱이 만든 로컬 데이터만 지웁니다.</p>
            <Button
              variant="warn"
              onClick={() => {
                ctx.store.resetAppData();
                ctx.refresh();
                navigate("/");
              }}
            >
              확인 후 초기화
            </Button>
          </div>
        ) : null}
      </div>
      <BottomNav active="settings" />
    </div>
  );
}
