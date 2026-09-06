import { useNavigate } from "react-router-dom";
import { useApp } from "../../app/context.tsx";
import { AppHeader } from "../../components/chrome.tsx";

export function AccountScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const account = ctx.account;
  const demo = Boolean(account?.isDemoGuest);

  return (
    <div className="app-page">
      <AppHeader title="로그인 계정 정보" onBack={() => navigate("/settings")} centerTitle />
      <div className="page-body stack" style={{ paddingTop: 12 }}>
        {demo ? (
          <p>이 기기에 저장된 데모 계정입니다. 실제 로그인 서비스와 연결되어 있지 않습니다.</p>
        ) : (
          <p className="tiny muted">이 기기에 저장된 로그인 정보입니다.</p>
        )}
        <div className="settings-row">
          <span>로그인 방식</span>
          <span className="tiny muted">{demo ? "데모 게스트" : "이메일"}</span>
        </div>
        <div className="settings-row">
          <span>이메일</span>
          <span className="tiny muted">{account?.email ?? "정보 없음"}</span>
        </div>
        <p className="tiny muted">이메일 변경과 비밀번호 변경은 아직 제공하지 않습니다.</p>
      </div>
    </div>
  );
}
