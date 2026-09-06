import { useNavigate } from "react-router-dom";
import { useApp } from "../../app/context.tsx";
import { AppHeader } from "../../components/chrome.tsx";
import { APP_NAME, APP_VERSION } from "../../config/app.ts";
import { isDemoMode } from "../../config/mode.ts";

export function AppInfoScreen() {
  const ctx = useApp();
  const navigate = useNavigate();

  return (
    <div className="app-page">
      <AppHeader title="앱 정보" onBack={() => navigate("/settings")} centerTitle />
      <div className="page-body stack" style={{ paddingTop: 12 }}>
        <div className="settings-row">
          <span>앱</span>
          <span className="tiny muted">{APP_NAME}</span>
        </div>
        <div className="settings-row">
          <span>버전</span>
          <span className="tiny muted">{APP_VERSION}</span>
        </div>
        <div className="settings-row">
          <span>동작 모드</span>
          <span className="tiny muted">{isDemoMode() ? "데모" : "실제"}</span>
        </div>
        <button type="button" className="settings-row" onClick={() => navigate("/terms")}>
          <span>이용약관</span>
          <span className="tiny muted">데모 초안</span>
        </button>
        <button type="button" className="settings-row" onClick={() => navigate("/privacy")}>
          <span>개인정보 처리방침</span>
          <span className="tiny muted">데모 초안</span>
        </button>
        {isDemoMode() ? (
          <button type="button" className="settings-row" onClick={() => navigate("/inbox")}>
            <span>데모 수신함</span>
            <span className="tiny muted">이 기기 메일</span>
          </button>
        ) : null}
        <p className="tiny muted">
          지도와 신호는 가상 데이터입니다. 실제 길 안내가 아닙니다.
          {ctx.providers.location.kind === "simulation" ? " 위치는 경로 위 시뮬레이션입니다." : ""}
        </p>
      </div>
    </div>
  );
}
