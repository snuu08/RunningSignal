import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PRIVACY_DRAFT, TERMS_DRAFT } from "../../data/demo/legal.ts";
import { Button, Field, Screen, TextInput } from "../../components/ui.tsx";
import { RunnerLogo } from "../../components/Logo.tsx";
import { saveProfile, useApp, useInbox } from "../../app/context.tsx";
import { isDemoMode } from "../../config/mode.ts";
import { validateNickname } from "../../domain/validation.ts";

export function WelcomeScreen() {
  const { appName, providers, refresh } = useApp();
  const navigate = useNavigate();
  return (
    <Screen>
      <div className="stack" style={{ alignItems: "center", paddingTop: 48 }}>
        <RunnerLogo />
        <h1 className="h1">{appName}</h1>
        <p className="muted" style={{ textAlign: "center" }}>
          출발·도착·페이스를 넣으면 연결된 보행길을 찾고, 긴 신호 대기만 우회합니다.
        </p>
        <Button variant="primary" onClick={() => navigate("/signup")}>
          계정 만들기
        </Button>
        <Button onClick={() => navigate("/login")}>로그인</Button>
        <Button
          onClick={async () => {
            const account = await providers.auth.loginDemoGuest();
            refresh();
            const profile = providers.profiles.get(account.id);
            if (profile.onboarded && profile.profileSetupCompleted) navigate("/home");
            else if (!profile.regionId) navigate("/onboarding/region");
            else navigate("/onboarding/profile");
          }}
        >
          데모로 체험하기
        </Button>
        <p className="tiny muted" style={{ textAlign: "center" }}>
          이 기기에만 저장되는 체험용 계정입니다. 실제 사용하는 비밀번호를 입력하지 마세요.
        </p>
      </div>
    </Screen>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} error={error}>
      <div className="row">
        <TextInput
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="current-password"
          style={{ flex: 1 }}
        />
        <button type="button" onClick={() => setShow((s) => !s)}>
          {show ? "숨기기" : "표시"}
        </button>
      </div>
    </Field>
  );
}

export function SignupScreen() {
  const ctx = useApp();
  const { providers, refresh } = ctx;
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agree, setAgree] = useState(false);
  const [persist, setPersist] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen title="회원가입">
      <p className="tiny muted">
        이 기기에만 저장되는 체험용 계정입니다. 실제 사용하는 비밀번호를 입력하지 마세요.
        비밀번호는 salted PBKDF2 검증값으로만 저장되며 운영용 인증이 아닙니다.
      </p>
      <Field label="이메일">
        <TextInput value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" />
      </Field>
      <Field label="닉네임">
        <TextInput
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          autoComplete="nickname"
        />
      </Field>
      <PasswordField label="비밀번호" value={password} onChange={setPassword} />
      <PasswordField label="비밀번호 확인" value={confirm} onChange={setConfirm} />
      <label className="row">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          <Link to="/terms">이용약관</Link>과 <Link to="/privacy">개인정보처리방침</Link>
          (데모용 초안)에 동의합니다.
        </span>
      </label>
      <label className="row">
        <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
        로그인 유지
      </label>
      {error ? <p className="error">{error}</p> : null}
      <Button
        variant="primary"
        onClick={async () => {
          if (!agree) {
            setError("필수 약관에 동의해 주세요.");
            return;
          }
          if (password !== confirm) {
            setError("비밀번호 확인이 일치하지 않습니다.");
            return;
          }
          const nickErr = validateNickname(nickname);
          if (nickErr) {
            setError(nickErr);
            return;
          }
          try {
            await providers.auth.signUp(email, password);
            const saveErr = saveProfile(ctx, { nickname: nickname.trim() });
            if (saveErr) {
              setError(saveErr);
              return;
            }
            if (!persist) providers.auth.logout();
            if (persist) {
              refresh();
              navigate("/onboarding/region");
            } else {
              navigate("/login");
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : "가입에 실패했습니다.");
          }
        }}
      >
        가입하기
      </Button>
      <Button onClick={() => navigate("/login")}>이미 계정이 있어요</Button>
    </Screen>
  );
}

export function LoginScreen() {
  const { providers, refresh } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [persist, setPersist] = useState(true);
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen title="로그인">
      <p className="tiny muted">
        이 기기에만 저장되는 체험용 계정입니다. 실제 사용하는 비밀번호를 입력하지 마세요.
      </p>
      <Field label="이메일">
        <TextInput value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <PasswordField label="비밀번호" value={password} onChange={setPassword} />
      <label className="row">
        <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
        로그인 유지
      </label>
      {error ? <p className="error">{error}</p> : null}
      <Button
        variant="primary"
        onClick={async () => {
          try {
            await providers.auth.login(email, password, persist);
            refresh();
            navigate("/home");
          } catch (err) {
            setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
          }
        }}
      >
        로그인
      </Button>
      <Button onClick={() => navigate("/forgot")}>비밀번호 찾기</Button>
    </Screen>
  );
}

export function ForgotScreen() {
  const { providers } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  return (
    <Screen title="비밀번호 찾기">
      <p className="muted">실제 메일은 발송되지 않습니다.</p>
      <Field label="이메일">
        <TextInput value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Button
        variant="primary"
        onClick={async () => {
          await providers.auth.requestPasswordReset(email);
          setDone(true);
        }}
      >
        재설정 링크 만들기
      </Button>
      {done ? (
        <Button onClick={() => navigate("/inbox")}>데모 수신함 열기</Button>
      ) : null}
    </Screen>
  );
}

export function InboxScreen() {
  const mails = useInbox();
  return (
    <Screen title="데모 수신함">
      {!isDemoMode() ? <p>데모 수신함은 demo 모드에서만 있습니다.</p> : null}
      {mails.length === 0 ? <p className="muted">받은 데모 메일이 없습니다.</p> : null}
      {mails.map((m) => (
        <div className="card stack" key={m.id}>
          <strong>{m.subject}</strong>
          <span className="tiny muted">{m.toEmail}</span>
          <Link to={`/reset?token=${m.resetToken}`}>재설정 링크 열기</Link>
        </div>
      ))}
    </Screen>
  );
}

export function ResetScreen() {
  const { providers } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <Screen title="비밀번호 재설정">
      <p className="tiny muted">실제 메일은 발송되지 않습니다. 토큰은 한 번만 사용할 수 있습니다.</p>
      <PasswordField label="새 비밀번호" value={password} onChange={setPassword} />
      {error ? <p className="error">{error}</p> : null}
      {ok ? <p>변경되었습니다. 새 비밀번호로 로그인해 주세요.</p> : null}
      <Button
        variant="primary"
        onClick={async () => {
          try {
            await providers.auth.resetPassword(token, password);
            setOk(true);
            setTimeout(() => navigate("/login"), 600);
          } catch (err) {
            setError(err instanceof Error ? err.message : "재설정에 실패했습니다.");
          }
        }}
      >
        변경하기
      </Button>
    </Screen>
  );
}

export function LegalScreen({ kind }: { kind: "terms" | "privacy" }) {
  return (
    <Screen title={kind === "terms" ? "이용약관" : "개인정보처리방침"}>
      <pre className="card" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
        {kind === "terms" ? TERMS_DRAFT : PRIVACY_DRAFT}
      </pre>
    </Screen>
  );
}
