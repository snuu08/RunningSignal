export type LocationPermissionStatus =
  | "granted"
  | "prompt"
  | "denied"
  | "unknown"
  | "unsupported";

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function vibrateSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export function geolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export async function readLocationPermission(): Promise<LocationPermissionStatus> {
  if (!geolocationSupported()) return "unsupported";
  const permissions = navigator.permissions;
  if (!permissions?.query) return "unknown";
  try {
    const result = await permissions.query({ name: "geolocation" });
    if (result.state === "granted") return "granted";
    if (result.state === "denied") return "denied";
    if (result.state === "prompt") return "prompt";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function locationStatusLabel(status: LocationPermissionStatus): string {
  if (status === "granted") return "허용됨";
  if (status === "prompt") return "허용 필요";
  if (status === "denied") return "차단됨";
  if (status === "unsupported") return "이 환경에서 지원하지 않음";
  return "확인할 수 없음";
}

export function requestBrowserLocation(): Promise<LocationPermissionStatus> {
  if (!geolocationSupported()) return Promise.resolve("unsupported");
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) resolve("denied");
        else resolve("unknown");
      },
      { maximumAge: 60_000, timeout: 8000, enableHighAccuracy: false },
    );
  });
}

export function speakGuidance(text: string): void {
  if (!speechSupported()) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ko-KR";
  utter.rate = 1;
  window.speechSynthesis.speak(utter);
}

export function stopGuidanceSpeech(): void {
  if (!speechSupported()) return;
  window.speechSynthesis.cancel();
}

export function tryVibrate(pattern: number | number[] = 40): boolean {
  if (!vibrateSupported()) return false;
  try {
    return Boolean(navigator.vibrate(pattern));
  } catch {
    return false;
  }
}

export async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  if (!wakeLockSupported()) return null;
  try {
    return await navigator.wakeLock.request("screen");
  } catch {
    return null;
  }
}
