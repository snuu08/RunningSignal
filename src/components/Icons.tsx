import type { ReactNode } from "react";

type IconProps = { size?: number; title?: string };

function Svg({
  size = 20,
  title,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.2" />
      <path d="m16 16 5 5" />
    </Svg>
  );
}

export function IconPin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21s7-6.2 7-11.2A7 7 0 1 0 5 9.8C5 14.8 12 21 12 21Z" />
      <circle cx="12" cy="10" r="2.2" />
    </Svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.4L15 15" />
    </Svg>
  );
}

export function IconChevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function IconBack(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 5 7 12l8 7" />
    </Svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6.5 10.5V20h11V10.5" />
    </Svg>
  );
}

export function IconRoutes(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M19 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M7 16.2 10.6 12l3 2.4L17 9.8" />
    </Svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.6v2.2M12 18.2v2.2M4.8 6.4l1.6 1.6M17.6 16l1.6 1.6M3.6 12h2.2M18.2 12h2.2M4.8 17.6l1.6-1.6M17.6 8l1.6-1.6" />
    </Svg>
  );
}

export function IconTurn(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 18V9a3 3 0 0 1 3-3h8" />
      <path d="m15 3 4 3-4 3" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12.5 10 17l9-10" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 6v12M6 12h12" />
    </Svg>
  );
}

export function IconHeart(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20s-7-4.5-9.1-8.3C1.3 9 2.4 5.8 5.5 5.2c1.9-.4 3.7.6 4.7 2.1L12 8.8l1.8-1.5c1-1.5 2.8-2.5 4.7-2.1 3.1.6 4.2 3.8 2.6 6.5C19 15.5 12 20 12 20Z" />
    </Svg>
  );
}

export function IconMore(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconMinus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 12h12" />
    </Svg>
  );
}
