import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../../app/context.tsx";
import { AppHeader } from "../../components/chrome.tsx";
import { Button } from "../../components/ui.tsx";
import { Sheet } from "../../components/Sheet.tsx";
import { downloadJson, exportRunRecords } from "../../domain/records-export.ts";

export function RecordsSettingsScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const account = ctx.account;
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const routes = account ? ctx.providers.runs.listRoutes(account.id) : [];
  const sessions = account ? ctx.providers.runs.listAllSessions(account.id) : [];
  const snap = account ? ctx.providers.runs.readSnapshot(account.id) : null;
  const active = (ctx.pendingSession ?? snap)?.phase === "running" || (ctx.pendingSession ?? snap)?.phase === "paused";

  return (
    <div className="app-page">
      <AppHeader title="기록 관리" onBack={() => navigate("/settings")} centerTitle />
      <div className="page-body stack" style={{ paddingTop: 12 }}>
        <p className="tiny muted">현재 로그인한 사용자의 러닝 기록만 다룹니다. 페이스와 설정은 그대로 둡니다.</p>
        {message ? <p className="tiny muted">{message}</p> : null}
        <div className="settings-row">
          <span>저장된 기록</span>
          <span className="tiny muted">{sessions.length === 0 ? "없음" : `${sessions.length}개`}</span>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            if (!account) return;
            if (sessions.length === 0) {
              setMessage("내보낼 러닝 기록이 없습니다.");
              return;
            }
            const payload = exportRunRecords(account.id, routes, sessions);
            const ok = downloadJson("flow-run-records.json", payload);
            setMessage(
              ok
                ? "기록을 파일로 저장했습니다. 거리(m), 시간(초), 페이스(초/km) 단위입니다."
                : "이 환경에서는 파일을 내려받을 수 없습니다.",
            );
          }}
        >
          기록 내보내기
        </Button>
        <Button variant="warn" onClick={() => setConfirm(true)}>
          전체 러닝 기록 삭제
        </Button>
      </div>
      {confirm ? (
        <Sheet title="기록을 삭제할까요?" onClose={() => setConfirm(false)}>
          {active ? (
            <>
              <p>진행 중인 러닝이 있습니다. 먼저 러닝을 종료한 뒤 삭제해 주세요.</p>
              <div className="stack" style={{ marginTop: 12 }}>
                <Button variant="primary" onClick={() => navigate("/run")}>
                  러닝으로 이동
                </Button>
                <Button onClick={() => setConfirm(false)}>취소</Button>
              </div>
            </>
          ) : (
            <>
              <p>
                지금 로그인한 계정의 저장된 러닝 경로 {routes.length}개와 기록 {sessions.length}개를
                삭제합니다. 닉네임, 페이스, 추천 설정은 지우지 않습니다.
              </p>
              <div className="stack" style={{ marginTop: 12 }}>
                <Button
                  variant="warn"
                  onClick={() => {
                    if (!account) return;
                    ctx.providers.runs.deleteAllRuns(account.id);
                    ctx.setPendingSession(null);
                    ctx.refresh();
                    setConfirm(false);
                    setMessage("러닝 기록을 삭제했습니다.");
                  }}
                >
                  기록만 삭제
                </Button>
                <Button onClick={() => setConfirm(false)}>취소</Button>
              </div>
            </>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}
