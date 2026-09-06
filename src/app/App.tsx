import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useApp } from "./context.tsx";
import { Button, Screen } from "../components/ui.tsx";
import {
  ForgotScreen,
  InboxScreen,
  LegalScreen,
  LoginScreen,
  ResetScreen,
  SignupScreen,
  WelcomeScreen,
} from "../features/auth/screens.tsx";
import { HistoryScreen } from "../features/history/HistoryScreen.tsx";
import { MyRoutesScreen } from "../features/history/MyRoutesScreen.tsx";
import { HomeScreen } from "../features/home/HomeScreen.tsx";
import { PopularListScreen } from "../features/home/PopularListScreen.tsx";
import { ProfileSetupScreen, RegionScreen } from "../features/onboarding/screens.tsx";
import { PaceSettingsScreen } from "../features/settings/PaceSettingsScreen.tsx";
import {
  LoadingScreen,
  PopularDetailScreen,
  RecommendEmptyScreen,
  RecommendScreen,
} from "../features/route-planning/screens.tsx";
import { JustRunScreen } from "../features/run/JustRunScreen.tsx";
import { ResultScreen, RunScreen } from "../features/run/screens.tsx";
import { SettingsScreen } from "../features/settings/SettingsScreen.tsx";
import { SplashScreen } from "../features/splash/SplashScreen.tsx";
import { readAppMode } from "../config/mode.ts";

function Guard({ children }: { children: ReactNode }) {
  const { account, profile } = useApp();
  if (!account) return <Navigate to="/welcome" replace />;
  if (!profile?.regionId) return <Navigate to="/onboarding/region" replace />;
  if (!profile.profileSetupCompleted) return <Navigate to="/onboarding/profile" replace />;
  return children;
}

export function App() {
  const { modeError, storeError, store, refresh } = useApp();
  if (readAppMode() === "real") {
    return (
      <Screen title="실제 모드를 켤 수 없습니다">
        <p>
          지도·신호·인증 실제 어댑터가 없습니다. 가상 데이터를 실제 지도에 섞지 않습니다. 데모
          모드로 전환해 주세요.
        </p>
        <p className="tiny muted">{modeError}</p>
      </Screen>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main">
        본문으로
      </a>
      {storeError ? (
        <div className="card" style={{ margin: 12 }}>
          {storeError}
          <Button
            onClick={() => {
              store.resetAppData();
              refresh();
            }}
          >
            앱 데이터 복구
          </Button>
        </div>
      ) : null}
      <div id="main">
        <Routes>
          <Route path="/" element={<SplashScreen />} />
          <Route path="/welcome" element={<WelcomeScreen />} />
          <Route path="/signup" element={<SignupScreen />} />
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/forgot" element={<ForgotScreen />} />
          <Route path="/inbox" element={<InboxScreen />} />
          <Route path="/reset" element={<ResetScreen />} />
          <Route path="/terms" element={<LegalScreen kind="terms" />} />
          <Route path="/privacy" element={<LegalScreen kind="privacy" />} />
          <Route path="/onboarding/region" element={<RegionScreen />} />
          <Route path="/onboarding/profile" element={<ProfileSetupScreen />} />
          <Route path="/onboarding/nickname" element={<ProfileSetupScreen />} />
          <Route
            path="/home"
            element={
              <Guard>
                <HomeScreen />
              </Guard>
            }
          />
          <Route
            path="/settings"
            element={
              <Guard>
                <SettingsScreen />
              </Guard>
            }
          />
          <Route
            path="/settings/paces"
            element={
              <Guard>
                <PaceSettingsScreen />
              </Guard>
            }
          />
          <Route
            path="/routes"
            element={
              <Guard>
                <MyRoutesScreen />
              </Guard>
            }
          />
          <Route
            path="/popular"
            element={
              <Guard>
                <PopularListScreen />
              </Guard>
            }
          />
          <Route
            path="/loading"
            element={
              <Guard>
                <LoadingScreen />
              </Guard>
            }
          />
          <Route
            path="/recommend"
            element={
              <Guard>
                <RecommendScreen />
              </Guard>
            }
          />
          <Route
            path="/recommend-empty"
            element={
              <Guard>
                <RecommendEmptyScreen />
              </Guard>
            }
          />
          <Route
            path="/popular/card/:cardId"
            element={
              <Guard>
                <PopularDetailScreen />
              </Guard>
            }
          />
          <Route
            path="/just-run"
            element={
              <Guard>
                <JustRunScreen />
              </Guard>
            }
          />
          <Route
            path="/run"
            element={
              <Guard>
                <RunScreen />
              </Guard>
            }
          />
          <Route
            path="/result"
            element={
              <Guard>
                <ResultScreen />
              </Guard>
            }
          />
          <Route
            path="/history/:routeId"
            element={
              <Guard>
                <HistoryScreen />
              </Guard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </>
  );
}
