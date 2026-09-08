import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { APP_NAME } from "../config/app.ts";
import type {
  CrossingPlan,
  PathEvaluation,
  PlaceRef,
  PopularRouteCard,
  Recommendation,
  RouteRequest,
  RunSession,
  SavedRoute,
  UserAppSettings,
  UserProfile,
} from "../domain/models.ts";
import { emptyPaceBook, normalizePaceBook, secondsToPaceParts, validatePace } from "../domain/pace.ts";
import { defaultAppSettings, routingPolicyFromSettings } from "../domain/settings.ts";
import { validateNickname } from "../domain/validation.ts";
import type { RoutingPolicyConfig } from "../domain/routing-policy.ts";
import { createProviders } from "../providers/mock/bundle.ts";
import { readDemoInbox } from "../providers/mock/auth.ts";
import { createBrowserStore } from "../storage/local-store.ts";
import type { AuthAccount, DemoMail } from "../domain/models.ts";

export type PlanDraft = {
  origin: PlaceRef | null;
  destination: PlaceRef | null;
  waypoints: PlaceRef[];
  loop: boolean;
  paceSeconds: number | null;
  paceTouched: boolean;
  paceSkipped: boolean;
  pick: "origin" | "destination" | "waypoint" | null;
};

export function emptyPlanDraft(): PlanDraft {
  return {
    origin: null,
    destination: null,
    waypoints: [],
    loop: false,
    paceSeconds: null,
    paceTouched: false,
    paceSkipped: false,
    pick: null,
  };
}

type AppContextValue = {
  appName: string;
  storeError: string | null;
  modeError: string | null;
  account: AuthAccount | null;
  profile: UserProfile | null;
  settings: UserAppSettings;
  refresh: () => void;
  providers: ReturnType<typeof createProviders>;
  store: ReturnType<typeof createBrowserStore>;
  draft: PlanDraft;
  setDraft: Dispatch<SetStateAction<PlanDraft>>;
  recommendation: Recommendation | null;
  seenCandidateIds: string[];
  setSeenCandidateIds: (ids: string[]) => void;
  setRecommendation: (value: Recommendation | null) => void;
  lastRequest: RouteRequest | null;
  setLastRequest: (req: RouteRequest | null) => void;
  activeEvaluation: PathEvaluation | null;
  setActiveEvaluation: (ev: PathEvaluation | null) => void;
  pendingSession: RunSession | null;
  setPendingSession: (s: RunSession | null) => void;
  pendingRenameRouteId: string | null;
  setPendingRenameRouteId: (id: string | null) => void;
  justRun: boolean;
  setJustRun: (value: boolean) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProviders({ children }: { children: ReactNode }) {
  const store = useMemo(() => createBrowserStore(), []);
  const [modeError] = useState<string | null>(null);
  const providers = useMemo(() => createProviders(store), [store]);

  const [account, setAccount] = useState(providers.auth.currentAccount());
  const [profile, setProfile] = useState(
    account ? providers.profiles.get(account.id) : null,
  );
  const [settings, setSettings] = useState<UserAppSettings>(
    account ? providers.settings.get(account.id) : defaultAppSettings(),
  );
  const [draft, setDraft] = useState<PlanDraft>(emptyPlanDraft);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [seenCandidateIds, setSeenCandidateIds] = useState<string[]>([]);
  const [lastRequest, setLastRequest] = useState<RouteRequest | null>(null);
  const [activeEvaluation, setActiveEvaluation] = useState<PathEvaluation | null>(null);
  const [pendingSession, setPendingSession] = useState<RunSession | null>(null);
  const [pendingRenameRouteId, setPendingRenameRouteId] = useState<string | null>(null);
  const [justRun, setJustRun] = useState(false);

  const refresh = () => {
    const next = providers.auth.currentAccount();
    setAccount(next);
    setProfile(next ? providers.profiles.get(next.id) : null);
    setSettings(next ? providers.settings.get(next.id) : defaultAppSettings());
  };

  return (
    <AppContext.Provider
      value={{
        appName: APP_NAME,
        storeError: store.error,
        modeError,
        account,
        profile,
        settings,
        refresh,
        providers,
        store,
        draft,
        setDraft,
        recommendation,
        setRecommendation,
        seenCandidateIds,
        setSeenCandidateIds,
        lastRequest,
        setLastRequest,
        activeEvaluation,
        setActiveEvaluation,
        pendingSession,
        setPendingSession,
        pendingRenameRouteId,
        setPendingRenameRouteId,
        justRun,
        setJustRun,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppProviders required");
  return ctx;
}

export function useInbox(): DemoMail[] {
  const { store } = useApp();
  return readDemoInbox(store);
}

export function saveProfile(
  ctx: AppContextValue,
  patch: Partial<UserProfile>,
): string | null {
  const account = ctx.account ?? ctx.providers.auth.currentAccount();
  if (!account) return "로그인이 필요합니다.";
  const current = ctx.providers.profiles.get(account.id);
  const next = { ...current, ...patch, accountId: account.id };
  if (next.nickname) {
    const err = validateNickname(next.nickname);
    if (err) return err;
  }
  next.paces = normalizePaceBook(next.paces ?? emptyPaceBook());
  for (const seconds of Object.values(next.paces)) {
    if (seconds === null) continue;
    const parts = secondsToPaceParts(seconds);
    const err = validatePace(parts);
    if (err) return err;
  }
  next.onboarded = Boolean(next.regionId && next.nickname);
  ctx.providers.profiles.save(next);
  ctx.refresh();
  return null;
}

export function saveSettings(
  ctx: AppContextValue,
  patch: Partial<UserAppSettings>,
): string | null {
  const account = ctx.account ?? ctx.providers.auth.currentAccount();
  if (!account) return "로그인이 필요합니다.";
  const saved = ctx.providers.settings.save(account.id, patch);
  if (!saved) return ctx.store.error ?? "설정을 저장하지 못했습니다.";
  ctx.refresh();
  return null;
}

export function currentRoutingPolicy(ctx: AppContextValue): RoutingPolicyConfig {
  return routingPolicyFromSettings(ctx.settings);
}

export function planStopsFromDraft(draft: PlanDraft): {
  origin: PlaceRef;
  destination: PlaceRef;
  waypoints: PlaceRef[];
} | null {
  if (!draft.origin) return null;
  if (draft.loop) {
    const extra =
      draft.destination && draft.destination.nodeId !== draft.origin.nodeId
        ? [draft.destination]
        : [];
    const waypoints = [...draft.waypoints, ...extra];
    if (waypoints.length === 0) return null;
    return { origin: draft.origin, destination: draft.origin, waypoints };
  }
  if (!draft.destination) return null;
  return {
    origin: draft.origin,
    destination: draft.destination,
    waypoints: [...draft.waypoints],
  };
}

export function popularToDraft(card: PopularRouteCard, current?: PlanDraft): PlanDraft {
  return {
    origin: card.origin,
    destination: card.destination,
    waypoints: [],
    loop: false,
    paceSeconds: current?.paceSeconds ?? null,
    paceTouched: current?.paceTouched ?? false,
    paceSkipped: current?.paceSkipped ?? false,
    pick: null,
  };
}

export function crossingById(
  plans: CrossingPlan[],
  id: string | null,
): CrossingPlan | null {
  if (!id) return null;
  return plans.find((p) => p.crossingId === id) ?? null;
}

export type { SavedRoute };
