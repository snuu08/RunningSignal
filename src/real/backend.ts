import { createClient } from "@supabase/supabase-js";
import type { Profile, RunRecord } from "./storage.ts";
import { validCoord, type Route } from "./core.ts";
const url = import.meta.env.VITE_SUPABASE_URL,
  anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const recoveryRequested =
  typeof window !== "undefined" &&
  window.location.hash.includes("type=recovery");
function makeCloud() {
  if (!url || !anon) return null;
  try {
    return createClient(url, anon, {
      auth: {
        detectSessionInUrl: true,
        persistSession: true,
        flowType: "pkce",
      },
    });
  } catch {
    return null;
  }
}
export const cloud = makeCloud();
export const oauthRedirect = () =>
  typeof window === "undefined" ? "" : `${location.origin}/real/auth`;
export function oauthErrorFromLocation() {
  if (typeof window === "undefined") return "";
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  return (
    query.get("error_description") ||
    hash.get("error_description") ||
    query.get("error") ||
    hash.get("error") ||
    ""
  );
}
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body ? "POST" : "GET",
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
    signal,
  });
  const data = await response
    .json()
    .catch(() => ({ error: "API 서버에 연결할 수 없습니다." }));
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}
export async function pushProfile(id: string, data: Profile) {
  if (!cloud) return;
  const { error } = await cloud.from("profiles").upsert({ id, data });
  if (error) throw error;
}
export async function syncRuns(
  owner: string,
  local: RunRecord[],
): Promise<RunRecord[]> {
  if (!cloud || owner === "guest") return local;
  for (const record of local.filter((r) => !r.synced)) {
    const { error } = await cloud.from("runs").upsert({
      id: record.id,
      user_id: owner,
      data: { ...record, synced: true },
    });
    if (error) throw error;
  }
  const { data, error } = await cloud
    .from("runs")
    .select("data")
    .eq("user_id", owner);
  if (error) throw error;
  return (data ?? [])
    .map((r) => r.data as RunRecord)
    .filter((r) => r.owner === owner);
}
export type PublicRoute = {
  id: string;
  user_id: string;
  title: string;
  region: string;
  route: Route;
  likes: number;
};
export async function publicRoutes(region: string): Promise<PublicRoute[]> {
  if (!cloud) return [];
  const { data, error } = await cloud.rpc("route_feed", {
    selected_region: region,
  });
  if (error) throw error;
  return (data ?? []).filter(
    (r: PublicRoute) =>
      typeof r.id === "string" &&
      typeof r.title === "string" &&
      r.route &&
      Number.isFinite(r.route.distanceM) &&
      r.route.distanceM > 0 &&
      Array.isArray(r.route.coordinates) &&
      r.route.coordinates.length >= 2 &&
      r.route.coordinates.length <= 20000 &&
      r.route.coordinates.every(validCoord),
  );
}
