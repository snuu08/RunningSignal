import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../../app/context.tsx";
import { RunnerLogo } from "../../components/Logo.tsx";
import { SPLASH_FIRST_MS, SPLASH_RETURN_MS } from "../../config/app.ts";

export function SplashScreen() {
  const { account, profile, store } = useApp();
  const navigate = useNavigate();
  const seen = store.read("hasSeenSplash", false);
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [ms] = useState(() => (reduce ? 200 : seen ? SPLASH_RETURN_MS : SPLASH_FIRST_MS));

  const go = () => {
    store.write("hasSeenSplash", true);
    if (account && profile?.onboarded && profile.profileSetupCompleted) {
      navigate("/home", { replace: true });
    } else if (account && !profile?.regionId) navigate("/onboarding/region", { replace: true });
    else if (account && !profile?.profileSetupCompleted) {
      navigate("/onboarding/profile", { replace: true });
    } else navigate("/welcome", { replace: true });
  };

  useEffect(() => {
    const id = window.setTimeout(go, ms);
    return () => window.clearTimeout(id);
  }, [ms]);

  return (
    <div className="splash">
      <button className="splash-logo" onClick={go} aria-label="건너뛰기">
        <RunnerLogo />
      </button>
    </div>
  );
}
