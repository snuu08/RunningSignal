import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { saveProfile, useApp } from "../../app/context.tsx";
import { AppHeader } from "../../components/chrome.tsx";
import { Button, Field, TextInput } from "../../components/ui.tsx";
import { validateNickname } from "../../domain/validation.ts";

export function NicknameScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState(ctx.profile?.nickname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <div className="app-page">
      <AppHeader title="닉네임" onBack={() => navigate("/settings")} centerTitle />
      <div className="page-body stack" style={{ paddingTop: 12 }}>
        <p className="tiny muted">홈과 올린 루트에 보이는 이름입니다. 2–12자로 저장합니다.</p>
        <Field label="닉네임">
          <TextInput
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
              setError(null);
            }}
            aria-label="닉네임"
          />
        </Field>
        {error ? <p className="error">{error}</p> : null}
        {saved ? <p className="tiny muted">닉네임을 저장했습니다.</p> : null}
        <Button
          variant="primary"
          onClick={() => {
            const check = validateNickname(name);
            if (check) {
              setError(check);
              setSaved(false);
              return;
            }
            const err = saveProfile(ctx, { nickname: name.trim() });
            if (err) {
              setError(err);
              setSaved(false);
              return;
            }
            setError(null);
            setSaved(true);
          }}
        >
          저장
        </Button>
      </div>
    </div>
  );
}
