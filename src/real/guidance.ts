import {
  pathLength,
  progressOnRoute,
  samplePath,
  type Coord,
  type Route,
} from "./core.ts";

export const PERSIST_KEY = "flow-real-persist";
export function persistLoginEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(PERSIST_KEY) !== "no";
}
export function setPersistLogin(keep: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PERSIST_KEY, keep ? "yes" : "no");
}

export function staticMapUrl(
  coordinates: Coord[],
  key: string,
  style = "dataviz-dark",
): string | null {
  if (!key || coordinates.length < 2) return null;
  const step = Math.max(40, pathLength(coordinates) / 36);
  let sampled = samplePath(coordinates, step);
  if (sampled.length < 2) sampled = [coordinates[0], coordinates.at(-1)!];
  while (sampled.length > 40) {
    sampled = sampled.filter((_, i) => i % 2 === 0 || i === sampled.length - 1);
  }
  const path = `stroke:#b4f6ce|width:3|${sampled.map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join("|")}`;
  const url = `https://api.maptiler.com/maps/${encodeURIComponent(style)}/static/auto/200x160.png?padding=0.12&attribution=bottomleft&key=${encodeURIComponent(key)}&path=${encodeURIComponent(path)}`;
  return url.length > 8000 ? null : url;
}

export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 1;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

export function vibrate(ms = 200) {
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(ms);
}

export function nextInstruction(route: Route, traveledM: number) {
  return (
    route.instructions
      .map((step) => ({
        ...step,
        atM: progressOnRoute(route.coordinates, step.coord).traveledM,
      }))
      .sort((a, b) => a.atM - b.atM)
      .find((s) => s.atM > traveledM + 8) ?? null
  );
}
