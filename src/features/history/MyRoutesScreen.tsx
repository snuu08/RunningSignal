import { useNavigate } from "react-router-dom";
import { useApp } from "../../app/context.tsx";
import { AppHeader, BottomNav } from "../../components/chrome.tsx";
import { Button } from "../../components/ui.tsx";
import { isDemoMode } from "../../config/mode.ts";
import { MyRouteRow } from "../home/HomeScreen.tsx";

export function MyRoutesScreen() {
  const { account, profile, providers } = useApp();
  const navigate = useNavigate();
  if (account && isDemoMode()) {
    providers.runs.ensureDemoSample(account.id, profile?.regionId ?? "seoul");
  }
  const routes = account ? providers.runs.listRoutes(account.id) : [];
  return (
    <div className="app-page">
      <AppHeader />
      <div className="page-body has-tab" style={{ paddingTop: 8 }}>
        <h1 className="h1">나의 루트</h1>
        {routes.length > 0 ? (
          <p className="tiny muted">루트를 열면 그 경로 거리로 평균 페이스를 계정에 저장할 수 있습니다.</p>
        ) : null}
        {routes.length === 0 ? (
          <div className="stack" style={{ marginTop: 16 }}>
            <p className="muted">아직 저장된 루트가 없습니다.</p>
            <Button variant="primary" onClick={() => navigate("/home")}>
              첫 러닝 준비하기
            </Button>
          </div>
        ) : (
          routes.map((route) => <MyRouteRow key={route.routeId} route={route} />)
        )}
      </div>
      <BottomNav active="routes" />
    </div>
  );
}
