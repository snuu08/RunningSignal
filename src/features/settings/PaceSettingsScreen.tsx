import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { saveProfile, useApp } from "../../app/context.tsx";
import { AppHeader } from "../../components/chrome.tsx";
import { IconCheck } from "../../components/Icons.tsx";
import { Sheet } from "../../components/Sheet.tsx";
import { Button } from "../../components/ui.tsx";
import type { PaceBook, PaceSlotId } from "../../domain/models.ts";
import {
  computeAveragePaceSeconds,
  durationPartsToSeconds,
  applyPaceSlot,
  emptyPaceBook,
  formatPaceSpoken,
  hasAnySavedPace,
  PACE_SLOTS,
  secondsToPaceParts,
  validateDurationParts,
  validatePace,
} from "../../domain/pace.ts";
import { recordPaceChoices } from "../../domain/records-export.ts";
import { DurationFields, PaceMinSecFields, parseOptionalNumber } from "../pace/inputs.tsx";
import { PaceCalculator } from "../pace/PaceCalculator.tsx";

export function PaceSettingsScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const picking = params.get("pick") === "1";
  const book = ctx.profile?.paces;
  const [editing, setEditing] = useState<PaceSlotId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PaceSlotId | null>(null);
  const pickedValue = picked ? (book?.[picked] ?? null) : null;

  return (
    <div className="app-page">
      <AppHeader
        title="내 러닝 페이스"
        onBack={() => navigate(picking ? "/home" : "/settings")}
        centerTitle
      />
      <div className="page-body stack" style={{ paddingTop: 8 }}>
        <p className="tiny muted">
          {picking
            ? hasAnySavedPace(book ?? emptyPaceBook())
              ? "불러올 페이스를 하나 선택한 뒤 오른쪽 아래 선택을 눌러 주세요."
              : "등록된 페이스가 없습니다. 설정에서 먼저 저장해 주세요."
            : "홈에서 기본으로 사용하는 페이스예요. 이번 러닝에서 바꾼 값은 자동 저장되지 않아요. 각 칸은 서로 따로 저장되며, 거리별 값을 고쳐도 평소 페이스는 바뀌지 않습니다."}
        </p>
        {PACE_SLOTS.map((slot) => {
          const value = book?.[slot.id] ?? null;
          const checked = picked === slot.id;
          if (picking) {
            return (
              <button
                key={slot.id}
                type="button"
                className="settings-row pace-pick-row"
                disabled={value === null}
                aria-pressed={checked}
                onClick={() => {
                  if (value === null) return;
                  setPicked(slot.id);
                }}
              >
                <span className="pace-check" data-checked={checked ? "true" : "false"} aria-hidden>
                  {checked ? <IconCheck size={14} /> : null}
                </span>
                <span className="pace-pick-label">{slot.label}</span>
                <span className="tiny muted">{value === null ? "미등록" : formatPaceSpoken(value)}</span>
              </button>
            );
          }
          return (
            <button
              key={slot.id}
              type="button"
              className="settings-row"
              onClick={() => {
                setError(null);
                setEditing(slot.id);
              }}
            >
              <span>{slot.label}</span>
              <span className="tiny muted">{value === null ? "미등록" : formatPaceSpoken(value)}</span>
            </button>
          );
        })}
      </div>
      {picking ? (
        <div className="pace-pick-bar">
          <Button
            variant="primary"
            className="pace-pick-confirm"
            disabled={pickedValue === null}
            onClick={() => {
              if (pickedValue === null) return;
              ctx.setDraft((prev) => ({
                ...prev,
                paceSeconds: pickedValue,
                paceTouched: true,
                paceSkipped: false,
              }));
              navigate("/home");
            }}
          >
            선택
          </Button>
        </div>
      ) : null}
      {editing ? (
        <PaceSlotEditor
          slotId={editing}
          value={book?.[editing] ?? null}
          book={book}
          error={error}
          onClose={() => setEditing(null)}
          onError={setError}
          onSave={(nextBook) => {
            const err = saveProfile(ctx, { paces: nextBook });
            if (err) {
              setError(err);
              return;
            }
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function PaceSlotEditor({
  slotId,
  value,
  book,
  error,
  onClose,
  onError,
  onSave,
}: {
  slotId: PaceSlotId;
  value: number | null;
  book: PaceBook | undefined;
  error: string | null;
  onClose: () => void;
  onError: (message: string | null) => void;
  onSave: (book: PaceBook) => void;
}) {
  const slot = PACE_SLOTS.find((item) => item.id === slotId);
  const parts = value ? secondsToPaceParts(value) : null;
  const [mode, setMode] = useState<"direct" | "finish">("direct");
  const [calcOpen, setCalcOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [minutes, setMinutes] = useState(parts ? String(parts.minutes) : "");
  const [seconds, setSeconds] = useState(parts ? String(parts.seconds) : "");
  const [hours, setHours] = useState("");
  const [finishMin, setFinishMin] = useState("");
  const [finishSec, setFinishSec] = useState("");
  const ctx = useApp();
  const recordChoices = ctx.account
    ? recordPaceChoices(
        ctx.providers.runs.listAllSessions(ctx.account.id),
        ctx.providers.runs.listRoutes(ctx.account.id),
      )
    : [];

  if (!slot) return null;

  const merge = (nextValue: number | null): PaceBook => applyPaceSlot(book, slotId, nextValue);

  const saveDirect = () => {
    const pace = {
      minutes: Number(minutes),
      seconds: Number(seconds),
    };
    const paceErr = validatePace(pace);
    if (paceErr) {
      onError(paceErr);
      return;
    }
    onSave(merge(pace.minutes * 60 + pace.seconds));
  };

  const saveFinish = () => {
    if (!slot.distanceKm) return;
    const hourN = parseOptionalNumber(hours) ?? 0;
    const minN = parseOptionalNumber(finishMin) ?? 0;
    const secN = parseOptionalNumber(finishSec) ?? 0;
    const timeErr = validateDurationParts(hourN, minN, secN);
    if (timeErr) {
      onError(timeErr);
      return;
    }
    const total = durationPartsToSeconds(hourN, minN, secN);
    const paceSeconds = total === null ? null : computeAveragePaceSeconds(slot.distanceKm, total);
    if (paceSeconds === null) {
      onError("거리와 시간이 있어야 계산할 수 있습니다.");
      return;
    }
    const paceErr = validatePace(secondsToPaceParts(paceSeconds));
    if (paceErr) {
      onError(paceErr);
      return;
    }
    const next = secondsToPaceParts(paceSeconds);
    setMinutes(String(next.minutes));
    setSeconds(String(next.seconds));
    onSave(merge(paceSeconds));
  };

  if (recordsOpen) {
    return (
      <Sheet title="내 기록에서 가져오기" onClose={() => setRecordsOpen(false)}>
        {recordChoices.length === 0 ? (
          <p className="tiny muted">가져올 러닝 기록이 없습니다.</p>
        ) : (
          <div className="stack">
            {recordChoices.map((row) => (
              <div key={row.sessionId} className="stack" style={{ gap: 4 }}>
                <p className="tiny muted">
                  {row.title}
                  {row.source === "demo" ? " · 데모" : ""} · {new Date(row.createdAt).toLocaleDateString("ko-KR")}
                </p>
                {row.movingPaceSeconds !== null ? (
                  <Button
                    onClick={() => {
                      const next = secondsToPaceParts(row.movingPaceSeconds!);
                      setMinutes(String(next.minutes));
                      setSeconds(String(next.seconds));
                      setMode("direct");
                      setRecordsOpen(false);
                    }}
                  >
                    이동 페이스 {formatPaceSpoken(row.movingPaceSeconds)}
                  </Button>
                ) : (
                  <p className="tiny muted">이동시간이 없어 이동 페이스를 쓰지 않습니다.</p>
                )}
                {row.overallPaceSeconds !== null ? (
                  <Button
                    onClick={() => {
                      const next = secondsToPaceParts(row.overallPaceSeconds!);
                      setMinutes(String(next.minutes));
                      setSeconds(String(next.seconds));
                      setMode("direct");
                      setRecordsOpen(false);
                    }}
                  >
                    전체 평균 페이스 {formatPaceSpoken(row.overallPaceSeconds)}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
        <Button onClick={() => setRecordsOpen(false)}>닫기</Button>
      </Sheet>
    );
  }

  if (calcOpen) {
    return (
      <Sheet title="달린 거리와 시간으로 계산하기" onClose={() => setCalcOpen(false)}>
        <PaceCalculator
          applyLabel="계산값 넣기"
          onCancel={() => setCalcOpen(false)}
          onApply={(paceSeconds) => {
            const next = secondsToPaceParts(paceSeconds);
            setMinutes(String(next.minutes));
            setSeconds(String(next.seconds));
            setMode("direct");
            setCalcOpen(false);
          }}
        />
      </Sheet>
    );
  }

  return (
    <Sheet title={slot.label} onClose={onClose}>
      {slot.distanceKm ? (
        <div className="row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
          <button
            type="button"
            className="region-chip"
            aria-pressed={mode === "direct"}
            onClick={() => setMode("direct")}
          >
            페이스 직접 입력
          </button>
          <button
            type="button"
            className="region-chip"
            aria-pressed={mode === "finish"}
            onClick={() => setMode("finish")}
          >
            완주 시간으로 계산
          </button>
        </div>
      ) : null}

      {mode === "finish" && slot.distanceKm ? (
        <div className="stack">
          <p className="sec">이 거리를 달리는 데 얼마나 걸렸나요?</p>
          <div className="settings-row">
            <span>거리</span>
            <span className="tiny muted">{slot.distanceKm} km</span>
          </div>
          <DurationFields
            hours={hours}
            minutes={finishMin}
            seconds={finishSec}
            onHours={setHours}
            onMinutes={setFinishMin}
            onSeconds={setFinishSec}
          />
          <p className="tiny muted">신호 대기나 휴식 시간을 포함하면 페이스가 더 느리게 계산돼요.</p>
        </div>
      ) : (
        <div className="stack">
          {slot.distanceKm ? (
            <>
              <p className="sec">이 거리의 1km 평균 페이스를 알려주세요.</p>
              <p className="tiny muted">페이스는 1km를 달리는 데 걸리는 시간이에요. 이 값은 평소 페이스와 따로 저장됩니다.</p>
            </>
          ) : (
            <>
              <p className="sec">평균적으로 달릴 때의 페이스를 알려주세요.</p>
              <p className="tiny muted">
                홈에서 기본으로 사용하는 페이스예요. 이번 러닝에서 바꾼 값은 자동 저장되지 않아요.
              </p>
            </>
          )}
          <PaceMinSecFields
            minutes={minutes}
            seconds={seconds}
            onMinutes={setMinutes}
            onSeconds={setSeconds}
          />
          <p className="tiny muted">예: 6분 30초/km</p>
          <Button onClick={() => setCalcOpen(true)}>거리와 시간으로 계산</Button>
          <Button onClick={() => setRecordsOpen(true)}>내 기록에서 가져오기</Button>
        </div>
      )}

      {error ? <p className="error">{error}</p> : null}
      <div className="stack" style={{ marginTop: 12 }}>
        <Button
          variant="primary"
          onClick={() => {
            onError(null);
            if (mode === "finish" && slot.distanceKm) saveFinish();
            else saveDirect();
          }}
        >
          저장
        </Button>
        {value !== null ? (
          <Button
            variant="warn"
            onClick={() => {
              onError(null);
              onSave(merge(null));
            }}
          >
            삭제
          </Button>
        ) : null}
        <Button onClick={onClose}>취소</Button>
      </div>
    </Sheet>
  );
}
