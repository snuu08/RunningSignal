import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../../app/context.tsx";
import { AppHeader, BottomNav } from "../../components/chrome.tsx";
import { Button } from "../../components/ui.tsx";
import { Sheet } from "../../components/Sheet.tsx";
import { isDemoMode } from "../../config/mode.ts";
import { speechSupported, vibrateSupported, wakeLockSupported } from "../../domain/device.ts";
import { detourAllowanceLabel, formatUsualPaceSummary, recommendStyleLabel } from "../../domain/settings.ts";
import { SettingsGroup, SettingsNavRow } from "./rows.tsx";

const SCROLL_KEY = "settings-main-scroll";

export function SettingsScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) el.scrollTop = Number(saved);
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String(el.scrollTop));
    };
  }, []);

  const go = (path: string) => {
    if (bodyRef.current) sessionStorage.setItem(SCROLL_KEY, String(bodyRef.current.scrollTop));
    navigate(path);
  };

  const guidanceBits = [
    ctx.settings.showRouteSignals ? "경로 신호" : null,
    ctx.settings.showNearbySignals ? "주변 신호" : null,
    speechSupported() && ctx.settings.voiceGuidance ? "음성" : null,
    vibrateSupported() && ctx.settings.vibrationGuidance ? "진동" : null,
    wakeLockSupported() && ctx.settings.keepScreenOn ? "화면 유지" : null,
  ].filter(Boolean);

  const activeRun = (() => {
    const snap = ctx.account ? ctx.providers.runs.readSnapshot(ctx.account.id) : null;
    const session = ctx.pendingSession ?? snap;
    return session?.phase === "running" || session?.phase === "paused";
  })();

  const logout = () => {
    ctx.providers.auth.logout();
    ctx.setPendingSession(null);
    ctx.setRecommendation(null);
    ctx.setActiveEvaluation(null);
    ctx.setLastRequest(null);
    ctx.setJustRun(false);
    ctx.refresh();
    navigate("/");
  };

  return (
    <div className="app-page">
      <AppHeader />
      <div className="page-body has-tab stack settings-main" ref={bodyRef} style={{ paddingTop: 8 }}>
        <h1 className="h1">설정</h1>
        {ctx.storeError ? (
          <div className="card">
            {ctx.storeError}
            <Button variant="secondary" onClick={() => ctx.store.resetAppData()}>
              앱 데이터만 복구 초기화
            </Button>
          </div>
        ) : null}

        <SettingsGroup title="내 정보">
          <SettingsNavRow
            title="닉네임"
            value={ctx.profile?.nickname ?? "미등록"}
            onClick={() => go("/settings/nickname")}
          />
          <SettingsNavRow
            title="로그인 계정 정보"
            value={ctx.account?.isDemoGuest ? "데모 계정" : (ctx.account?.email ?? "—")}
            onClick={() => go("/settings/account")}
          />
        </SettingsGroup>

        <SettingsGroup title="러닝 설정">
          <SettingsNavRow
            title="내 러닝 페이스"
            value={formatUsualPaceSummary(ctx.profile?.paces.usual)}
            onClick={() => go("/settings/paces")}
          />
          <SettingsNavRow
            title="경로 추천"
            value={`${recommendStyleLabel(ctx.settings.recommendStyle)} · ${detourAllowanceLabel(ctx.settings.detourAllowance)}`}
            onClick={() => go("/settings/routing")}
          />
          <SettingsNavRow
            title="지도·러닝 안내"
            value={guidanceBits.length > 0 ? guidanceBits.join(" · ") : "기본"}
            onClick={() => go("/settings/guidance")}
          />
        </SettingsGroup>

        <SettingsGroup title="데이터 및 앱">
          <SettingsNavRow title="기록 관리" value="내보내기 · 삭제" onClick={() => go("/settings/records")} />
          <SettingsNavRow title="위치 권한" value="데모 시뮬레이션" onClick={() => go("/settings/location")} />
          <SettingsNavRow title="앱 정보" value="FLOW RUN" onClick={() => go("/settings/about")} />
        </SettingsGroup>

        <SettingsGroup title="계정">
          <button type="button" className="settings-row settings-danger-row" onClick={() => setLogoutOpen(true)}>
            <span>로그아웃</span>
          </button>
        </SettingsGroup>

        {isDemoMode() ? (
          <div className="settings-danger-block">
            <p className="tiny muted">회원 탈퇴가 아닙니다. 이 기기의 데모 앱 데이터만 지웁니다.</p>
            <button type="button" className="settings-row settings-danger-row" onClick={() => setResetOpen(true)}>
              <span>데모 데이터 초기화</span>
            </button>
          </div>
        ) : null}
      </div>
      <BottomNav active="settings" />

      {logoutOpen ? (
        <Sheet title="로그아웃" onClose={() => setLogoutOpen(false)}>
          {activeRun ? (
            <p>진행 중인 러닝이 있습니다. 로그아웃하면 이 기기에서 로그인 상태가 해제됩니다. 저장된 기록은 지워지지 않습니다.</p>
          ) : (
            <p>이 기기에서 로그아웃합니다. 저장된 기록은 삭제되지 않습니다.</p>
          )}
          <div className="stack" style={{ marginTop: 12 }}>
            {activeRun ? (
              <Button
                variant="primary"
                onClick={() => {
                  setLogoutOpen(false);
                  navigate("/run");
                }}
              >
                러닝으로 돌아가기
              </Button>
            ) : null}
            <Button
              variant="warn"
              onClick={() => {
                logout();
              }}
            >
              {activeRun ? "러닝을 두고 로그아웃" : "로그아웃"}
            </Button>
            <Button onClick={() => setLogoutOpen(false)}>취소</Button>
          </div>
        </Sheet>
      ) : null}

      {resetOpen ? (
        <Sheet title="데모 데이터 초기화" onClose={() => setResetOpen(false)}>
          <p>이 앱이 만든 로컬 데모 데이터만 지웁니다. 다른 사이트 저장소는 건드리지 않습니다.</p>
          <p className="tiny muted">회원 탈퇴가 아니며, 서버 계정 삭제도 아닙니다.</p>
          <div className="stack" style={{ marginTop: 12 }}>
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
            <Button onClick={() => setResetOpen(false)}>취소</Button>
          </div>
        </Sheet>
      ) : null}

    </div>
  );
}
