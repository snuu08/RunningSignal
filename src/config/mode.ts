export type AppMode = "demo" | "real";

export type CapabilityStatus = {
  area: "auth" | "map" | "signal" | "location" | "mail";
  mode: AppMode;
  ready: boolean;
  detail: string;
};

export function readAppMode(): AppMode {
  const raw = import.meta.env.VITE_APP_MODE;
  if (raw === "real") return "real";
  return "demo";
}

export function isDemoMode(): boolean {
  return readAppMode() === "demo";
}

export function demoCapabilityStatuses(): CapabilityStatus[] {
  return [
    { area: "auth", mode: "demo", ready: true, detail: "체험용 로컬 계정" },
    { area: "map", mode: "demo", ready: true, detail: "가상 보행망" },
    { area: "signal", mode: "demo", ready: true, detail: "고정 주기 데모 계획" },
    { area: "location", mode: "demo", ready: true, detail: "경로 위 시뮬레이션" },
    { area: "mail", mode: "demo", ready: true, detail: "데모 수신함만 사용" },
  ];
}
