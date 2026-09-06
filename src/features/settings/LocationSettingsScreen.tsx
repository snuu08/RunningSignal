import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../../app/context.tsx";
import { AppHeader } from "../../components/chrome.tsx";
import { Button } from "../../components/ui.tsx";
import {
  locationStatusLabel,
  readLocationPermission,
  requestBrowserLocation,
  type LocationPermissionStatus,
} from "../../domain/device.ts";

export function LocationSettingsScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const [status, setStatus] = useState<LocationPermissionStatus>("unknown");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    readLocationPermission().then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="app-page">
      <AppHeader title="위치 권한" onBack={() => navigate("/settings")} centerTitle />
      <div className="page-body stack" style={{ paddingTop: 12 }}>
        <div className="settings-row">
          <span>앱 위치 측정</span>
          <span className="tiny muted">데모 시뮬레이션</span>
        </div>
        <p className="tiny muted">{ctx.providers.location.note}</p>
        <p className="tiny muted">브라우저 위치 권한을 받아도 실제 GPS 러닝 측정이 켜지지 않습니다.</p>
        <div className="settings-row">
          <span>브라우저 위치 권한</span>
          <span className="tiny muted">{locationStatusLabel(status)}</span>
        </div>
        {status === "denied" ? (
          <p className="tiny muted">
            앱이 차단을 직접 풀 수 없습니다. 브라우저 또는 기기의 사이트 권한 설정에서 위치를 바꿔 주세요.
          </p>
        ) : null}
        {status === "unsupported" ? (
          <p className="tiny muted">이 환경에서는 브라우저 위치 API를 지원하지 않습니다.</p>
        ) : (
          <Button
            variant="primary"
            disabled={busy || status === "denied"}
            onClick={async () => {
              setBusy(true);
              const next = await requestBrowserLocation();
              setStatus(next);
              setBusy(false);
            }}
          >
            위치 사용 허용
          </Button>
        )}
      </div>
    </div>
  );
}
