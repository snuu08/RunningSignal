import { buildDemoSavedRoute } from "../../data/demo/saved-route.ts";
import type { RegionId, RunSession, SavedRoute, UserProfile } from "../../domain/models.ts";
import { normalizePaceBook } from "../../domain/pace.ts";
import type { LocalStore } from "../../storage/local-store.ts";
import type { RunRepository } from "../contracts/index.ts";

export function normalizeProfile(raw: Partial<UserProfile> & { accountId: string }): UserProfile {
  const nickname = raw.nickname ?? null;
  const regionId = raw.regionId ?? null;
  const onboarded = Boolean(regionId && nickname);
  return {
    accountId: raw.accountId,
    regionId,
    nickname,
    onboarded,
    profileSetupCompleted: raw.profileSetupCompleted ?? onboarded,
    paces: normalizePaceBook(raw.paces),
  };
}

function withDemoPace(route: SavedRoute): SavedRoute {
  if (route.source === "demo" && !route.averagePaceSeconds) {
    return { ...route, averagePaceSeconds: 360 };
  }
  return route;
}

function elapsedPaceSeconds(session: RunSession, fallbackLengthM: number): number | null {
  const distanceM = session.progressM > 0 ? session.progressM : fallbackLengthM;
  if (distanceM <= 0 || session.times.totalElapsedSec <= 0) return null;
  return Math.round(session.times.totalElapsedSec / (distanceM / 1000));
}

export function createMockRuns(store: LocalStore): RunRepository {
  const routesOf = (accountId: string) => store.read<SavedRoute[]>(`routes:${accountId}`, []);
  const sessionsOf = (accountId: string) => store.read<RunSession[]>(`sessions:${accountId}`, []);

  return {
    listRoutes(accountId) {
      return routesOf(accountId)
        .map(withDemoPace)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    listSessions(accountId, routeId) {
      return sessionsOf(accountId)
        .filter((s) => s.routeId === routeId && s.saveState === "saved")
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    saveSession(accountId, session, routeDraft) {
      const routes = routesOf(accountId);
      const sessions = sessionsOf(accountId);
      const existingSession = sessions.find((s) => s.sessionId === session.sessionId);
      if (existingSession) {
        const route = routes.find((r) => r.routeId === existingSession.routeId) ?? {
          ...routeDraft,
          recentSessionId: existingSession.sessionId,
        };
        return { route, session: existingSession };
      }

      let route = routes.find((r) => r.fingerprint === routeDraft.fingerprint);
      if (!route) {
        route = { ...routeDraft, recentSessionId: session.sessionId };
        routes.unshift(route);
      } else {
        route = { ...route, recentSessionId: session.sessionId };
        const idx = routes.findIndex((r) => r.routeId === route?.routeId);
        routes[idx] = route;
      }

      const saved: RunSession = {
        ...session,
        routeId: route.routeId,
        saveState: "saved",
        accountId,
      };
      const computed = elapsedPaceSeconds(saved, route.lengthM);
      if (computed) route.averagePaceSeconds = computed;
      sessions.unshift(saved);
      store.write(`routes:${accountId}`, routes);
      store.write(`sessions:${accountId}`, sessions);
      return { route, session: saved };
    },
    getRoute(accountId, routeId) {
      const found = routesOf(accountId).find((r) => r.routeId === routeId);
      return found ? withDemoPace(found) : null;
    },
    renameRoute(accountId, routeId, title) {
      const next = title.trim();
      if (!next) return null;
      const routes = routesOf(accountId);
      const idx = routes.findIndex((r) => r.routeId === routeId);
      if (idx < 0) return null;
      routes[idx] = { ...routes[idx], title: next };
      store.write(`routes:${accountId}`, routes);
      return routes[idx];
    },
    deleteRoute(accountId, routeId) {
      store.write(
        `routes:${accountId}`,
        routesOf(accountId).filter((r) => r.routeId !== routeId),
      );
      store.write(
        `sessions:${accountId}`,
        sessionsOf(accountId).filter((s) => s.sessionId && s.routeId !== routeId),
      );
      store.write(`demoRouteSeeded:${accountId}`, true);
    },
    setRouteAveragePace(accountId, routeId, paceSeconds) {
      const routes = routesOf(accountId);
      const idx = routes.findIndex((r) => r.routeId === routeId);
      if (idx < 0) return null;
      routes[idx] = { ...routes[idx], averagePaceSeconds: paceSeconds };
      store.write(`routes:${accountId}`, routes);
      return routes[idx];
    },
    ensureDemoSample(accountId, regionId: RegionId) {
      const seededFlag = store.read(`demoRouteSeeded:${accountId}`, false);
      const routes = routesOf(accountId);
      if (routes.length > 0) {
        store.write(`demoRouteSeeded:${accountId}`, true);
        return routes[0];
      }
      if (seededFlag) return null;
      const seeded = buildDemoSavedRoute(accountId, regionId);
      if (!seeded) return null;
      store.write(`routes:${accountId}`, [seeded]);
      store.write(`demoRouteSeeded:${accountId}`, true);
      return seeded;
    },
    writeSnapshot(accountId, session) {
      if (!session) {
        store.remove(`runSnapshot:${accountId}`);
        return;
      }
      store.write(`runSnapshot:${accountId}`, session);
    },
    readSnapshot(accountId) {
      return store.read<RunSession | null>(`runSnapshot:${accountId}`, null);
    },
  };
}

export function createProfileStore(store: LocalStore) {
  return {
    get(accountId: string): UserProfile {
      const raw = store.read<Partial<UserProfile> | null>(`profile:${accountId}`, null);
      return normalizeProfile({
        accountId,
        ...raw,
      });
    },
    save(profile: Partial<UserProfile> & { accountId: string }) {
      store.write(`profile:${profile.accountId}`, normalizeProfile(profile));
    },
  };
}
