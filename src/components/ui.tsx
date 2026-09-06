import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { SoftPill } from "./chrome.tsx";

export function DemoBadge({ children }: { children: ReactNode }) {
  return <SoftPill>{children}</SoftPill>;
}

export function Screen({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="app-page">
      <div className="page-body stack" style={{ paddingTop: 16 }}>
        {title ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h1 className="h1" style={{ fontSize: 22 }}>
              {title}
            </h1>
            <SoftPill>데모</SoftPill>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function Button({
  variant = "ghost",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "warn" | "secondary";
}) {
  const cls =
    variant === "primary"
      ? "btn-primary"
      : variant === "warn"
        ? "btn-warn"
        : variant === "secondary"
          ? "btn-secondary"
          : "btn-ghost";
  return <button {...props} className={`${cls} ${props.className ?? ""}`} />;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <span className="muted tiny">{hint}</span> : null}
      {error ? <span className="error">{error}</span> : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}
