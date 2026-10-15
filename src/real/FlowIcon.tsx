import type { CSSProperties } from "react";

export type FlowIconName = "home" | "route" | "settings" | "pin" | "arrow" | "target" | "leaf" | "activity" | "swap" | "chevron" | "clock";
const paths: Record<FlowIconName, string> = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  route: "M6 5h10a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h10M3 5a2 2 0 1 0 4 0 2 2 0 1 0-4 0M18 19l2 2-2 2",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM9 10a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  target: "M12 2v3m0 14v3M2 12h3m14 0h3M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0M10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  leaf: "M20 3C8 2 3 7 5 14s14 8 15-11ZM4 21 15 10",
  activity: "M2 12h5l3-8 4 16 3-8h5",
  swap: "M7 3v17m-4-4 4 4 4-4M17 21V4m-4 4 4-4 4 4",
  chevron: "m9 5 7 7-7 7",
  clock: "M12 8v5l3 2M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0",
};

export function FlowIcon({ name, size = 20, style }: { name: FlowIconName; size?: number; style?: CSSProperties }) {
  return <svg className="flow-icon" aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name]} /></svg>;
}
