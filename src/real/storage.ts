import type { PaceBook } from "../domain/models.ts";
import { normalizePaceBook } from "../domain/pace.ts";
import type { Route, Track } from "./core.ts";
export type Profile = {
  nickname: string;
  region: string;
  pace: number;
  paces: PaceBook;
  onboarded: boolean;
  detour: number;
  voice: boolean;
  vibration: boolean;
  wake: boolean;
  avoidStairs: boolean;
  avoidOverpass: boolean;
  avoidAlley: boolean;
  followCam: boolean;
};
export const defaultProfile: Profile = {
  nickname: "",
  region: "서울",
  pace: 360,
  paces: {
    usual: null,
    fiveK: null,
    tenK: null,
    half: null,
    full: null,
  },
  onboarded: false,
  detour: 0.1,
  voice: false,
  vibration: false,
  wake: true,
  avoidStairs: true,
  avoidOverpass: false,
  avoidAlley: false,
  followCam: true,
};
export function normalizeProfile(raw?: Partial<Profile> | null): Profile {
  const paces = normalizePaceBook({
    usual: raw?.paces?.usual ?? raw?.pace ?? null,
    fiveK: raw?.paces?.fiveK ?? null,
    tenK: raw?.paces?.tenK ?? null,
    half: raw?.paces?.half ?? null,
    full: raw?.paces?.full ?? null,
  });
  return {
    ...defaultProfile,
    ...raw,
    paces,
    pace: paces.usual ?? defaultProfile.pace,
    avoidOverpass: !!raw?.avoidOverpass,
    avoidAlley: !!raw?.avoidAlley,
    followCam: raw?.followCam !== false,
  };
}
export type RunRecord = {
  id: string;
  owner: string;
  title: string;
  route: Route | null;
  routeKey: string;
  track: Track;
  activeSec: number;
  manualPauseSec: number;
  elapsedSec: number;
  startedAt: number;
  finishedAt: number;
  complete: boolean;
  synced: boolean;
};
const DB = "flow-run-real-v1";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("runs", { keyPath: "id" });
      r.result.createObjectStore("state");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function transaction<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = action(tx.objectStore(store));
    let value: T;
    req.onsuccess = () => {
      value = req.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export const saveRun = (r: RunRecord) =>
  transaction("runs", "readwrite", (s) => s.put(r));
export const deleteRun = (id: string) =>
  transaction("runs", "readwrite", (s) => s.delete(id));
export async function listRuns(owner: string): Promise<RunRecord[]> {
  const rows = await transaction<RunRecord[]>("runs", "readonly", (s) =>
    s.getAll(),
  );
  return rows
    .filter((r) => r.owner === owner)
    .sort((a, b) => b.startedAt - a.startedAt);
}
export const saveState = (key: string, value: unknown) =>
  transaction("state", "readwrite", (s) => s.put(value, key));
export const readState = <T>(key: string) =>
  transaction<T | undefined>("state", "readonly", (s) => s.get(key));
export const clearState = (key: string) =>
  transaction("state", "readwrite", (s) => s.delete(key));
export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
