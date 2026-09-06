import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { APP_NAME } from "../config/app.ts";
import { RunnerLogo } from "./Logo.tsx";
import {
  IconBack,
  IconChevronDown,
  IconHome,
  IconRoutes,
  IconSettings,
} from "./Icons.tsx";

export function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" className="app-brand" onClick={onClick} aria-label={APP_NAME}>
      <RunnerLogo className="logo-mark" />
      <span className="brand-name">{APP_NAME}</span>
    </button>
  );
}

export function AppHeader({
  right,
  title,
  onBack,
  centerTitle,
}: {
  right?: ReactNode;
  title?: string;
  onBack?: () => void;
  centerTitle?: boolean;
}) {
  return (
    <header className={`app-header${centerTitle && onBack ? " centered" : ""}`}>
      {onBack ? (
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <IconBack />
        </button>
      ) : (
        <Brand />
      )}
      {title ? <div className="header-title">{title}</div> : null}
      <div>{right}</div>
    </header>
  );
}

export function RegionPill({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="region-pill" onClick={onClick}>
      {label}
      <IconChevronDown size={16} />
    </button>
  );
}

export function SoftPill({ children }: { children: ReactNode }) {
  return <span className="soft-pill">{children}</span>;
}

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-head">
      <h2 className="h2">{title}</h2>
      {action ? (
        <button type="button" className="more-link" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}

export function BottomNav({ active }: { active: "home" | "routes" | "settings" }) {
  const navigate = useNavigate();
  return (
    <nav className="tabbar" aria-label="하단 탐색">
      <button
        type="button"
        className={active === "home" ? "active" : ""}
        onClick={() => navigate("/home")}
      >
        <IconHome />
        홈
      </button>
      <button
        type="button"
        className={active === "routes" ? "active" : ""}
        onClick={() => navigate("/routes")}
      >
        <IconRoutes />
        나의 루트
      </button>
      <button
        type="button"
        className={active === "settings" ? "active" : ""}
        onClick={() => navigate("/settings")}
      >
        <IconSettings />
        설정
      </button>
    </nav>
  );
}

export function MetricStrip({
  items,
  className,
}: {
  items: { label: string; value: string }[];
  className?: string;
}) {
  return (
    <div className={className ? `stat-strip ${className}` : "stat-strip"}>
      {items.map((item) => (
        <div className="stat" key={item.label}>
          <div className="val">{item.value}</div>
          <div className="lbl">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
