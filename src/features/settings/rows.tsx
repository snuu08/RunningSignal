import type { ReactNode } from "react";
import { IconChevron } from "../../components/Icons.tsx";

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{title}</h2>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

export function SettingsNavRow({
  title,
  value,
  onClick,
}: {
  title: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="settings-row settings-nav-row" onClick={onClick}>
      <span className="settings-row-copy">
        <span className="settings-row-title">{title}</span>
        {value ? <span className="tiny muted">{value}</span> : null}
      </span>
      <IconChevron size={16} />
    </button>
  );
}

export function SettingsToggleRow({
  title,
  value,
  checked,
  onChange,
}: {
  title: string;
  value?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="settings-row settings-nav-row">
      <span className="settings-row-copy">
        <span className="settings-row-title">{title}</span>
        {value ? <span className="tiny muted">{value}</span> : null}
      </span>
      <button
        type="button"
        className={`settings-switch${checked ? " on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
      >
        <span className="settings-switch-knob" />
      </button>
    </div>
  );
}
