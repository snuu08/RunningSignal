import { Field, TextInput } from "../../components/ui.tsx";

export function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function PaceMinSecFields({
  minutes,
  seconds,
  onMinutes,
  onSeconds,
}: {
  minutes: string;
  seconds: string;
  onMinutes: (value: string) => void;
  onSeconds: (value: string) => void;
}) {
  return (
    <div className="pace-minsec">
      <Field label="분">
        <TextInput
          inputMode="numeric"
          value={minutes}
          onChange={(e) => onMinutes(e.target.value)}
        />
      </Field>
      <Field label="초">
        <TextInput
          inputMode="numeric"
          value={seconds}
          onChange={(e) => onSeconds(e.target.value)}
        />
      </Field>
      <span className="pace-unit">분/km</span>
    </div>
  );
}

export function DurationFields({
  hours,
  minutes,
  seconds,
  onHours,
  onMinutes,
  onSeconds,
}: {
  hours: string;
  minutes: string;
  seconds: string;
  onHours: (value: string) => void;
  onMinutes: (value: string) => void;
  onSeconds: (value: string) => void;
}) {
  return (
    <div className="pace-duration">
      <Field label="시간">
        <TextInput inputMode="numeric" value={hours} onChange={(e) => onHours(e.target.value)} />
      </Field>
      <Field label="분">
        <TextInput inputMode="numeric" value={minutes} onChange={(e) => onMinutes(e.target.value)} />
      </Field>
      <Field label="초">
        <TextInput inputMode="numeric" value={seconds} onChange={(e) => onSeconds(e.target.value)} />
      </Field>
    </div>
  );
}
