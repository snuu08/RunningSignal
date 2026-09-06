import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { saveProfile, useApp } from "../../app/context.tsx";
import { AppHeader } from "../../components/chrome.tsx";
import { Sheet } from "../../components/Sheet.tsx";
import { Button, Field, TextInput } from "../../components/ui.tsx";
import { REGIONS } from "../../data/demo/regions.ts";
import { secondsToPaceParts, validatePace } from "../../domain/pace.ts";
import { validateNickname } from "../../domain/validation.ts";
import { PaceCalculator } from "../pace/PaceCalculator.tsx";
import { PaceMinSecFields } from "../pace/inputs.tsx";

export function RegionScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  if (!ctx.account) return <Navigate to="/welcome" replace />;
  return (
    <div className="app-page">
      <AppHeader title="지역 선택" centerTitle />
      <div className="page-body stack">
        <h1 className="h1">당신의 지역을 선택하세요</h1>
        <p className="tiny muted">실제 API 지원 확정 도시가 아닙니다. 데모 체험용 목록입니다.</p>
        {REGIONS.map((r) => (
          <button
            key={r.id}
            className="check-row"
            onClick={() => {
              const setupDone = Boolean(ctx.profile?.profileSetupCompleted);
              saveProfile(ctx, { regionId: r.id });
              navigate(setupDone ? "/home" : "/onboarding/profile");
            }}
          >
            <span>
              {r.label}
              <span className="tiny muted"> · {r.demoLabel}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ProfileSetupScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  if (!ctx.account) return <Navigate to="/welcome" replace />;
  if (ctx.profile?.profileSetupCompleted) return <Navigate to="/home" replace />;

  const usual = ctx.profile?.paces.usual;
  const parts = usual ? secondsToPaceParts(usual) : null;
  const [name, setName] = useState(ctx.profile?.nickname ?? "");
  const [minutes, setMinutes] = useState(parts ? String(parts.minutes) : "");
  const [seconds, setSeconds] = useState(parts ? String(parts.seconds) : "");
  const [error, setError] = useState<string | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);

  const finish = (skipPace: boolean) => {
    const nickErr = validateNickname(name);
    if (nickErr) {
      setError(nickErr);
      return;
    }
    const current = ctx.profile?.paces;
    let usualSeconds: number | null = skipPace ? (current?.usual ?? null) : null;
    if (!skipPace && (minutes.trim() !== "" || seconds.trim() !== "")) {
      const pace = {
        minutes: Number(minutes),
        seconds: Number(seconds),
      };
      const paceErr = validatePace(pace);
      if (paceErr) {
        setError(paceErr);
        return;
      }
      usualSeconds = pace.minutes * 60 + pace.seconds;
    }
    const err = saveProfile(ctx, {
      nickname: name.trim(),
      paces: {
        usual: usualSeconds,
        fiveK: current?.fiveK ?? null,
        tenK: current?.tenK ?? null,
        half: current?.half ?? null,
        full: current?.full ?? null,
      },
      profileSetupCompleted: true,
    });
    if (err) {
      setError(err);
      return;
    }
    navigate("/home");
  };

  return (
    <div className="app-page">
      <AppHeader title="프로필" centerTitle />
      <div className="page-body stack">
        <h1 className="h1">환영합니다</h1>
        <p className="sec">러닝에 사용할 닉네임과 평균 페이스를 알려주세요.</p>
        <Field label="닉네임" error={error}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <p className="sec">평균적으로 달릴 때의 페이스를 알려주세요.</p>
          <p className="tiny muted">페이스는 1km를 달리는 데 걸리는 시간이에요.</p>
          <PaceMinSecFields
            minutes={minutes}
            seconds={seconds}
            onMinutes={setMinutes}
            onSeconds={setSeconds}
          />
          <p className="tiny muted">예: 6분 30초/km</p>
        </div>
        <Button onClick={() => setCalcOpen(true)}>페이스를 모르겠어요</Button>
        <Button variant="primary" onClick={() => finish(false)}>
          시작하기
        </Button>
        <Button onClick={() => finish(true)}>나중에 입력하기</Button>
      </div>
      {calcOpen ? (
        <Sheet title="달린 거리와 시간으로 계산하기" onClose={() => setCalcOpen(false)}>
          <PaceCalculator
            onCancel={() => setCalcOpen(false)}
            onApply={(paceSeconds) => {
              const next = secondsToPaceParts(paceSeconds);
              setMinutes(String(next.minutes));
              setSeconds(String(next.seconds));
              setCalcOpen(false);
            }}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

export { ProfileSetupScreen as NicknameScreen };
