import { describe, expect, it } from "vitest";
import { emptyPlanDraft, planStopsFromDraft } from "../app/context.tsx";
import { createMockAuth } from "../providers/mock/auth.ts";
import { createMockCatalog } from "../providers/mock/catalog.ts";
import { createMockRuns } from "../providers/mock/runs.ts";
import { createProfileStore } from "../providers/mock/runs.ts";
import { LocalStore, MemoryStorage } from "../storage/local-store.ts";
import { NETWORKS } from "../data/demo/networks.ts";
import { planRoutes } from "../domain/routing-policy.ts";
import { createSignalLookup, DEMO_PLANS } from "../data/demo/signals.ts";
import type { RunSession, SavedRoute } from "../domain/models.ts";

function store() {
  return new LocalStore(new MemoryStorage());
}

describe("auth and reset", () => {
  it("signs up, rejects a bad password, and isolates accounts", async () => {
    const db = store();
    const auth = createMockAuth(db);
    const a = await auth.signUp("one@example.com", "password1");
    await expect(auth.login("one@example.com", "wrong-pass", true)).rejects.toThrow();
    const again = await auth.login("one@example.com", "password1", true);
    expect(again.id).toBe(a.id);
    await expect(auth.signUp("one@example.com", "password1")).rejects.toThrow(/이미/);
    const b = await auth.signUp("two@example.com", "password2");
    expect(b.id).not.toBe(a.id);
  });

  it("keeps the nickname set at signup after login", async () => {
    const db = store();
    const auth = createMockAuth(db);
    const profiles = createProfileStore(db);
    const account = await auth.signUp("nick@example.com", "password1");
    profiles.save({
      accountId: account.id,
      regionId: null,
      nickname: "새벽러너",
      onboarded: false,
    });
    auth.logout();
    const again = await auth.login("nick@example.com", "password1", true);
    expect(profiles.get(again.id).nickname).toBe("새벽러너");
  });

  it("resets a password once and rejects token reuse", async () => {
    const db = store();
    const auth = createMockAuth(db);
    await auth.signUp("reset@example.com", "old-pass1");
    const { mail } = await auth.requestPasswordReset("reset@example.com");
    expect(mail?.resetToken).toBeTruthy();
    await auth.resetPassword(mail!.resetToken, "new-pass1");
    await auth.login("reset@example.com", "new-pass1", true);
    await expect(auth.resetPassword(mail!.resetToken, "newer-pass")).rejects.toThrow(/이미/);
  });
});

describe("likes and routes", () => {
  it("toggles a sample like without double counting", () => {
    const db = store();
    const catalog = createMockCatalog(db);
    const card = catalog.list("seoul")[0];
    const first = catalog.toggleLike("acc1", card.cardId);
    const again = catalog.toggleLike("acc1", card.cardId);
    const third = catalog.toggleLike("acc1", card.cardId);
    expect(first.displayCount).toBe(card.sampleLikeBase + 1);
    expect(again.liked).toBe(false);
    expect(again.displayCount).toBe(card.sampleLikeBase);
    expect(third.displayCount).toBe(card.sampleLikeBase + 1);
  });

  it("saves one card with two sessions and ignores duplicate session ids", () => {
    const db = store();
    const runs = createMockRuns(db);
    const network = NETWORKS.seoul;
    const planned = planRoutes(
      {
        origin: network.places[0],
        destination: network.places[1],
        waypoints: [],
        paceSecondsPerKm: 360,
        departure: { kind: "clock-start", atSec: 0 },
        seed: 7,
        nowSec: 0,
      },
      network,
      createSignalLookup(DEMO_PLANS.seoul),
    );
    if ("error" in planned) throw new Error(planned.error);
    const routeDraft: Omit<SavedRoute, "recentSessionId"> = {
      routeId: "r1",
      accountId: "acc1",
      title: "카페-시청",
      fingerprint: planned.chosen.candidate.fingerprint,
      directedEdgeIds: planned.chosen.candidate.directedEdges.map((e) => e.directedEdgeId),
      geometry: planned.chosen.candidate.geometry,
      geometryVersion: 1,
      lengthM: planned.chosen.candidate.lengthM,
      regionId: "seoul",
      originLabel: "a",
      destinationLabel: "b",
      source: "demo",
      createdAt: 1,
    };
    const session = (id: string): RunSession => ({
      sessionId: id,
      accountId: "acc1",
      routeId: null,
      title: "카페-시청",
      source: "demo",
      phase: "completed",
      runningSub: "moving",
      pauseReason: null,
      saveState: "unsaved",
      completion: "full",
      planned: {
        request: {
          origin: network.places[0],
          destination: network.places[1],
          waypoints: [],
          paceSecondsPerKm: 360,
          departure: { kind: "clock-start", atSec: 0 },
          seed: 7,
          nowSec: 0,
        },
        evaluation: planned.chosen,
      },
      actualDirectedEdgeIds: routeDraft.directedEdgeIds,
      progressM: routeDraft.lengthM,
      times: { movingSec: 100, signalWaitSec: 10, manualPauseSec: 0, totalElapsedSec: 110 },
      simSpeed: 1,
      startedAtSec: 0,
      endedAtSec: 110,
      createdAt: Date.now(),
    });
    runs.saveSession("acc1", session("s1"), routeDraft);
    runs.saveSession("acc1", session("s1"), routeDraft);
    runs.saveSession("acc1", session("s2"), routeDraft);
    expect(runs.listRoutes("acc1")).toHaveLength(1);
    expect(runs.listSessions("acc1", "r1")).toHaveLength(2);
    expect(runs.listRoutes("acc2")).toHaveLength(0);
  });

  it("adds one demo sample route per empty account", () => {
    const db = store();
    const runs = createMockRuns(db);
    const first = runs.ensureDemoSample("demo-acc", "seoul");
    const again = runs.ensureDemoSample("demo-acc", "seoul");
    expect(first?.source).toBe("demo");
    expect(first?.lengthM).toBeGreaterThan(0);
    expect(again?.routeId).toBe(first?.routeId);
    expect(runs.listRoutes("demo-acc")).toHaveLength(1);
    expect(runs.listRoutes("other-acc")).toHaveLength(0);
  });

  it("renames and deletes a saved route without reseeding", () => {
    const db = store();
    const runs = createMockRuns(db);
    const seeded = runs.ensureDemoSample("edit-acc", "seoul");
    expect(seeded).toBeTruthy();
    const renamed = runs.renameRoute("edit-acc", seeded!.routeId, "출근길");
    expect(renamed?.title).toBe("출근길");
    expect(runs.renameRoute("edit-acc", seeded!.routeId, "   ")).toBeNull();
    runs.deleteRoute("edit-acc", seeded!.routeId);
    expect(runs.listRoutes("edit-acc")).toHaveLength(0);
    expect(runs.ensureDemoSample("edit-acc", "seoul")).toBeNull();
    expect(runs.listRoutes("edit-acc")).toHaveLength(0);
  });
});

describe("storage safety", () => {
  it("does not use a full localStorage clear and keeps schema version", () => {
    const memory = new MemoryStorage();
    memory.setItem("other-app", "keep");
    const db = new LocalStore(memory);
    db.write("users", [{ id: "1" }]);
    db.resetAppData();
    expect(memory.getItem("other-app")).toBe("keep");
    expect(db.read("schemaVersion", 0)).toBe(1);
  });

  it("persists profile fields used after reload", () => {
    const db = store();
    const profiles = createProfileStore(db);
    profiles.save({
      accountId: "a",
      regionId: "daegu",
      nickname: "러너",
      onboarded: true,
    });
    expect(profiles.get("a").nickname).toBe("러너");
    expect(profiles.get("a").regionId).toBe("daegu");
  });

  it("keeps pace books per account and leaves empty slots unregistered", () => {
    const db = store();
    const profiles = createProfileStore(db);
    profiles.save({
      accountId: "a",
      regionId: "seoul",
      nickname: "러너",
      onboarded: true,
      profileSetupCompleted: true,
      paces: { usual: 390, fiveK: null, tenK: null, half: null, full: null },
    });
    expect(profiles.get("a").paces.usual).toBe(390);
    expect(profiles.get("a").paces.fiveK).toBeNull();
    expect(profiles.get("b").paces.usual).toBeNull();
  });

  it("treats a legacy onboarded profile as setup complete", () => {
    const db = store();
    db.write("profile:old", {
      accountId: "old",
      regionId: "seoul",
      nickname: "옛닉",
      onboarded: true,
    });
    const profiles = createProfileStore(db);
    expect(profiles.get("old").profileSetupCompleted).toBe(true);
    expect(profiles.get("old").paces.usual).toBeNull();
  });
});

describe("home draft stops", () => {
  it("returns to the origin when loop is on", () => {
    const [origin, via] = NETWORKS.seoul.places;
    const stops = planStopsFromDraft({
      ...emptyPlanDraft(),
      origin,
      destination: via,
      loop: true,
    });
    expect(stops).not.toBeNull();
    expect(stops!.origin.nodeId).toBe(origin.nodeId);
    expect(stops!.destination.nodeId).toBe(origin.nodeId);
    expect(stops!.waypoints.map((w) => w.nodeId)).toEqual([via.nodeId]);
  });

  it("ignores waypoints when loop is off", () => {
    const [origin, dest, via] = NETWORKS.seoul.places;
    const stops = planStopsFromDraft({
      ...emptyPlanDraft(),
      origin,
      destination: dest,
      waypoints: [via],
      loop: false,
    });
    expect(stops).not.toBeNull();
    expect(stops!.origin.nodeId).toBe(origin.nodeId);
    expect(stops!.destination.nodeId).toBe(dest.nodeId);
    expect(stops!.waypoints).toEqual([]);
  });
});
