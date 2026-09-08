import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useLocation, useNavigate } from "react-router-dom";
import {
  api,
  cloud,
  oauthErrorFromLocation,
  oauthRedirect,
  recoveryRequested,
  publicRoutes,
  pushProfile,
  syncRuns,
  type PublicRoute,
} from "./backend.ts";
import {
  meters,
  paceLabel,
  rankRoutes,
  routeKey,
  routeCompleted,
  trackSegments,
  timeLabel,
  validPace,
  type Coord,
  type Place,
  type Route,
} from "./core.ts";
import { RealMap } from "./RealMap.tsx";
import {
  clearState,
  defaultProfile,
  deleteRun,
  downloadJson,
  listRuns,
  readState,
  saveRun,
  saveState,
  type Profile,
  type RunRecord,
} from "./storage.ts";
import { locate, useGpsRun, type LiveRun } from "./useGpsRun.ts";
import "./real.css";
import { RunnerLogo } from "../components/Logo.tsx";
type Status = {
  places: boolean;
  routes: boolean;
  seoulSignals: boolean;
  signalPrediction: boolean;
  signalDetail: string;
};
const regions = ["서울", "인천", "대구", "성남"];
const emptyCoords: Coord[] = [];
function Thumbnail({ route }: { route: Route | null }) {
  const points = route?.coordinates;
  if (!points?.length) return <div className="real-thumb">↗</div>;
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]),
    minX = Math.min(...xs),
    minY = Math.min(...ys),
    dx = Math.max(...xs) - minX || 0.001,
    dy = Math.max(...ys) - minY || 0.001;
  return (
    <svg
      className="real-thumb"
      viewBox="0 0 100 80"
      aria-label="경로 모양 미리보기"
    >
      <polyline
        points={points
          .map(
            (p) =>
              `${8 + ((p[0] - minX) / dx) * 84},${72 - ((p[1] - minY) / dy) * 64}`,
          )
          .join(" ")}
        fill="none"
        stroke="#b4f6ce"
        strokeWidth="2"
      />
    </svg>
  );
}
function PlaceInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
}) {
  const [query, setQuery] = useState(value?.name ?? ""),
    [items, setItems] = useState<Place[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value) {
      setQuery(value.name);
      setItems([]);
    }
  }, [value]);
  useEffect(() => {
    if (query.trim().length < 2 || query === value?.name) {
      setItems([]);
      setBusy(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      api<{ places: Place[] }>(
        `places?q=${encodeURIComponent(query.trim())}`,
        undefined,
        ctrl.signal,
      )
        .then((r) => {
          setItems(r.places);
          setError(
            r.places.length
              ? ""
              : "검색 결과가 없어요. 지도에서 위치를 선택할 수도 있어요.",
          );
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, value?.name]);
  return (
    <div className="real-field">
      <label>
        {label}
        <input
          value={query}
          placeholder="장소 이름을 검색하세요"
          onChange={(e) => {
            const q = e.target.value;
            if (value) onChange(null);
            setQuery(q);
            setError("");
          }}
          autoComplete="off"
        />
      </label>
      {busy && <small>검색 중…</small>}
      {error && <small role="status">{error}</small>}
      {items.length > 0 && (
        <div className="place-results">
          {items.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onChange(p);
                setQuery(p.name);
                setItems([]);
              }}
            >
              <strong>{p.name}</strong>
              <small>{p.address}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function Auth({
  onGuest,
  notice,
  recovering,
}: {
  onGuest: () => void;
  notice: (s: string) => void;
  recovering: boolean;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">(
      recovering ? "reset" : "login",
    ),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [agree, setAgree] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const sub = cloud?.auth.onAuthStateChange((e) => {
      if (e === "PASSWORD_RECOVERY") setMode("reset");
    });
    return () => sub?.data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (recovering) setMode("reset");
  }, [recovering]);
  useEffect(() => {
    const err = oauthErrorFromLocation();
    if (err) notice(err);
  }, [notice]);
  async function oauth(provider: "kakao" | "google") {
    if (!cloud)
      return notice(
        "계정 서버 연결 전입니다. 기기에 기록하며 시작할 수 있어요.",
      );
    if (!agree)
      return notice("소셜 로그인 전에 약관·개인정보처리방침에 동의해 주세요.");
    setBusy(true);
    try {
      const { error } = await cloud.auth.signInWithOAuth({
        provider,
        options: { redirectTo: oauthRedirect() },
      });
      if (error) throw error;
    } catch (e) {
      notice(e instanceof Error ? e.message : "소셜 로그인에 실패했습니다.");
      setBusy(false);
    }
  }
  async function submit() {
    if (!cloud)
      return notice(
        "계정 서버 연결 전입니다. 기기에 기록하며 시작할 수 있어요.",
      );
    if (mode === "signup" && !agree)
      return notice("약관·개인정보처리방침 동의가 필요합니다.");
    setBusy(true);
    try {
      const redirect = oauthRedirect();
      const result =
        mode === "login"
          ? await cloud.auth.signInWithPassword({ email, password })
          : mode === "signup"
            ? await cloud.auth.signUp({
                email,
                password,
                options: {
                  emailRedirectTo: redirect,
                  data: { consent_version: "2026-09-07" },
                },
              })
            : mode === "forgot"
              ? await cloud.auth.resetPasswordForEmail(email, {
                  redirectTo: redirect,
                })
              : await cloud.auth.updateUser({ password });
      if (result.error) throw result.error;
      notice(
        mode === "signup"
          ? "이메일을 확인해 가입을 완료해 주세요."
          : mode === "forgot"
            ? "가입된 주소라면 비밀번호 재설정 메일이 전송됩니다."
            : mode === "reset"
              ? "비밀번호를 변경했습니다."
              : "로그인했습니다.",
      );
      if (mode === "reset") location.assign("/real/home");
    } catch (e) {
      notice(e instanceof Error ? e.message : "인증에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="real-auth">
      <div className="runner-mark">
        <RunnerLogo />
      </div>
      <p className="eyebrow">YOUR PACE. YOUR WAY.</p>
      <h1>
        내 속도로,
        <br />
        이어 달리다.
      </h1>
      <p className="muted">곧고 편안한 러닝 경로를 찾아보세요.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>
          {
            {
              login: "로그인",
              signup: "회원가입",
              forgot: "비밀번호 찾기",
              reset: "새 비밀번호 설정",
            }[mode]
          }
        </h2>
        {mode !== "reset" && (
          <label>
            이메일
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
        )}
        {mode !== "forgot" && (
          <label>
            비밀번호
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </label>
        )}
        {(mode === "signup" || mode === "login") && (
          <label className="check">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <span>
              <a href="/real/legal" target="_blank" rel="noreferrer">
                이용약관·개인정보처리방침
              </a>
              에 동의합니다. 카카오·Google 로그인에도 필요합니다.
            </span>
          </label>
        )}
        <button className="primary" disabled={busy || !cloud}>
          {busy
            ? "처리 중…"
            : mode === "login"
              ? "로그인"
              : mode === "signup"
                ? "가입하기"
                : mode === "forgot"
                  ? "재설정 메일 보내기"
                  : "비밀번호 변경"}
        </button>
      </form>
      {mode !== "reset" && mode !== "forgot" && (
        <div className="oauth-row">
          <button
            type="button"
            className="oauth kakao"
            disabled={busy || !cloud}
            onClick={() => void oauth("kakao")}
          >
            카카오로 계속
          </button>
          <button
            type="button"
            className="oauth google"
            disabled={busy || !cloud}
            onClick={() => void oauth("google")}
          >
            Google로 계속
          </button>
        </div>
      )}
      <div className="button-row">
        <button onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
          {mode === "signup" ? "로그인으로" : "회원가입"}
        </button>
        <button onClick={() => setMode(mode === "forgot" ? "login" : "forgot")}>
          {mode === "forgot" ? "로그인으로" : "비밀번호 찾기"}
        </button>
      </div>
      <button className="secondary" onClick={onGuest}>
        계정 없이 기기에 기록하기
      </button>
      {!cloud && <small>계정 서버 연결 준비 중 · 기기 기록은 사용 가능</small>}
    </section>
  );
}
export function RealApp() {
  const navigate = useNavigate(),
    locationState = useLocation(),
    page = locationState.pathname.replace("/real/", "") || "home";
  const [user, setUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(!cloud),
    [recovering, setRecovering] = useState(recoveryRequested),
    [guest, setGuest] = useState(
      () => sessionStorage.getItem("flow-real-guest") === "yes",
    );
  const owner = user?.id ?? "guest",
    ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [profile, setProfile] = useState<Profile>(defaultProfile),
    [loaded, setLoaded] = useState(false),
    [status, setStatus] = useState<Status | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState<Place | null>(null),
    [destination, setDestination] = useState<Place | null>(null),
    [via, setVia] = useState<Place | null>(null),
    [showVia, setShowVia] = useState(false),
    [pick, setPick] = useState<"origin" | "destination" | "via" | null>(null),
    [loop, setLoop] = useState(false);
  const [pace, setPace] = useState(360),
    [routes, setRoutes] = useState<Route[]>([]),
    [candidate, setCandidate] = useState(0),
    [position, setPosition] = useState<Coord | null>(null),
    [fit, setFit] = useState(0);
  const [records, setRecords] = useState<RunRecord[]>([]),
    [result, setResult] = useState<RunRecord | null>(null),
    [selectedKey, setSelectedKey] = useState<string | null>(null),
    [publicItems, setPublicItems] = useState<PublicRoute[]>([]),
    [recovery, setRecovery] = useState<LiveRun | null>(null);
  const [calcKm, setCalcKm] = useState("5"),
    [calcMin, setCalcMin] = useState("30"),
    [nickname, setNickname] = useState(""),
    [signalId, setSignalId] = useState(""),
    [signalResult, setSignalResult] = useState<unknown>(null);
  const request = useRef<AbortController | null>(null),
    saving = useRef(false),
    lastCheckpoint = useRef(0),
    runOwner = useRef(owner);
  const notice = useCallback((s: string) => setMessage(s), []);
  const run = useGpsRun((r) => {
    if (Date.now() - lastCheckpoint.current > 5000) {
      lastCheckpoint.current = Date.now();
      void saveState(`active:${runOwner.current}`, r).catch(() =>
        notice("기기 저장 공간에 기록을 백업하지 못했어요."),
      );
    }
  });
  const route = routes[candidate] ?? null;
  const go = (next: string) => {
    if (run.live && run.live.phase !== "ended" && next !== "run") {
      notice("진행 중인 러닝을 종료한 뒤 이동해 주세요.");
      return;
    }
    navigate(`/real/${next}`);
    setMessage("");
  };
  useEffect(() => {
    if (user && !recovering && page === "auth")
      navigate("/real/home", { replace: true });
  }, [user, recovering, page, navigate]);
  useEffect(() => {
    if (!cloud) return;
    const recoveryHash = recoveryRequested;
    void cloud.auth.getSession().then(({ data }) => {
      if (!recoveryHash) setUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const sub = cloud.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (event !== "PASSWORD_RECOVERY" && !recoveryHash)
        setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => sub.data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    void api<Status>("status")
      .then(setStatus)
      .catch(() =>
        notice("API 서버 연결을 확인해 주세요. GPS 기록은 사용할 수 있어요."),
      );
  }, [notice]);
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setRecords([]);
    setRecovery(null);
    setResult(null);
    void Promise.all([
      readState<Profile>(`profile:${owner}`),
      listRuns(owner),
      readState<LiveRun>(`active:${owner}`),
      readState<RunRecord>(`result:${owner}`),
    ])
      .then(async ([p, rows, active, savedResult]) => {
        if (cancelled) return;
        setProfile(p ?? defaultProfile);
        setNickname(p?.nickname ?? "");
        setPace(p?.pace ?? 360);
        setRecords(rows);
        if (savedResult) setResult(savedResult);
        if (active) setRecovery(active);
        setLoaded(true);
        if (cloud && user) {
          const response = await cloud
            .from("profiles")
            .select("data")
            .eq("id", owner)
            .maybeSingle();
          const remote = response.data?.data as Profile | undefined;
          const meta = user.user_metadata ?? {};
          const fromOauth = [meta.full_name, meta.name, meta.nickname].find(
            (v) => typeof v === "string" && v.trim().length >= 2,
          );
          const seeded =
            remote ??
            p ??
            (typeof fromOauth === "string"
              ? { ...defaultProfile, nickname: fromOauth.trim().slice(0, 20) }
              : null);
          if (!cancelled && seeded && !p) {
            setProfile(seeded);
            setNickname(seeded.nickname);
            setPace(seeded.pace);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true);
          notice(
            "기기 저장소를 열지 못했습니다. 저장 공간·브라우저 설정을 확인해 주세요.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [owner, notice, user]);
  useEffect(() => {
    let canceled = false;
    void publicRoutes(profile.region)
      .then((r) => {
        if (!canceled) setPublicItems(r);
      })
      .catch(() => {
        if (!canceled) setPublicItems([]);
      });
    return () => {
      canceled = true;
    };
  }, [profile.region]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (
      !profile.wake ||
      run.live?.phase !== "running" ||
      !("wakeLock" in navigator)
    )
      return;
    let lock: WakeLockSentinel | null = null,
      disposed = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      void navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (disposed) void l.release();
          else lock = l;
        })
        .catch(() => notice("화면 켜짐 유지를 사용할 수 없습니다."));
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      disposed = true;
      void lock?.release();
      document.removeEventListener("visibilitychange", acquire);
    };
  }, [profile.wake, run.live?.phase, notice]);
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      notice(
        e instanceof Error
          ? e.message
          : "처리하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function updateProfile(p: Profile) {
    if (
      p.nickname.trim().length < 2 ||
      p.nickname.trim().length > 20 ||
      !validPace(p.pace)
    )
      throw new Error("닉네임은 2~20자, 페이스는 2:00~30:00/km로 입력하세요.");
    await saveState(`profile:${owner}`, p);
    setProfile(p);
    if (user) {
      try {
        await pushProfile(owner, p);
      } catch {
        notice("기기에 저장했어요. 계정 설정 동기화는 다시 시도해 주세요.");
      }
    }
  }
  async function usePosition() {
    const f = await locate();
    setPosition(f.coord);
    setOrigin({ id: "gps", name: "현재 위치", coord: f.coord });
    if (f.accuracy > 30)
      notice(
        `현재 위치 오차 약 ${Math.round(f.accuracy)}m · 출발 전 위치를 확인해 주세요.`,
      );
  }
  async function findRoutes() {
    if (!origin || !destination || !validPace(pace))
      throw new Error(
        "검색 결과 또는 지도에서 출발지·목적지를 선택하고 페이스를 입력해 주세요.",
      );
    if (meters(origin.coord, destination.coord) < 20 && !via)
      throw new Error(
        "출발지와 목적지를 다르게 선택하거나 경유지를 추가해 주세요.",
      );
    request.current?.abort();
    const ctrl = new AbortController();
    request.current = ctrl;
    setRoutes([]);
    setCandidate(0);
    navigate("/real/loading");
    try {
      const stops = loop
        ? [destination, ...(via ? [via] : [])]
        : via
          ? [via]
          : [];
      const [response] = await Promise.all([
        api<{ routes: Route[]; partial: boolean }>(
          "routes",
          {
            origin,
            destination: loop ? origin : destination,
            waypoints: stops,
            pace,
          },
          ctrl.signal,
        ),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      if (ctrl.signal.aborted) return;
      const raw = profile.avoidStairs
        ? response.routes.filter((r) => r.option === "30")
        : response.routes;
      const next = rankRoutes(raw, profile.detour, 500);
      if (!next.length)
        throw new Error(
          profile.avoidStairs
            ? "계단 제외 경로를 확인하지 못했어요. 설정을 변경하거나 다시 시도해 주세요."
            : "조건에 맞는 보행 경로가 없어요.",
        );
      setRoutes(
        next.map((r) => ({
          ...r,
          name: `${origin.name} → ${destination.name}${loop ? " → 출발지" : ""}`,
        })),
      );
      navigate("/real/recommend");
      if (response.partial)
        notice("일부 후보 요청이 실패해 확인된 경로만 보여드려요.");
    } catch (e) {
      if (!ctrl.signal.aborted) {
        navigate("/real/home");
        throw e;
      }
    }
  }
  async function startRun(selected: Route | null) {
    runOwner.current = owner;
    await run.start(selected);
    navigate("/real/run");
    if (profile.voice && "speechSynthesis" in window)
      speechSynthesis.speak(
        new SpeechSynthesisUtterance(
          "러닝을 시작합니다. 실제 보행 신호를 확인해 주세요.",
        ),
      );
    if (profile.vibration) navigator.vibrate?.(100);
  }
  async function finish() {
    if (!confirm("러닝을 종료하고 기록을 확인할까요?")) return;
    const live = run.end();
    if (!live) return;
    const r = live.route;
    const complete = !!r && routeCompleted(r, live.track);
    const record: RunRecord = {
      id: live.id,
      owner: runOwner.current,
      title: r ? r.name : `${profile.region} 자유 러닝`,
      route: r,
      routeKey: r ? routeKey(r.coordinates) : `free:${live.id}`,
      track: live.track,
      activeSec: live.activeSec,
      manualPauseSec: live.manualPauseSec,
      elapsedSec: live.activeSec + live.manualPauseSec,
      startedAt: live.startedAt,
      finishedAt: Date.now(),
      complete,
      synced: false,
    };
    setResult(record);
    try {
      await saveState(`result:${record.owner}`, record);
      await clearState(`active:${record.owner}`);
    } catch {
      notice(
        "결과는 화면에 남아 있지만 자동 백업하지 못했어요. 저장 또는 내보내기를 해 주세요.",
      );
    }
    setRecovery(null);
    navigate("/real/result");
  }
  async function saveResult() {
    if (!result || saving.current) return;
    saving.current = true;
    try {
      if (result.track.distanceM < 10)
        throw new Error("10m 이상 기록한 러닝부터 저장할 수 있어요.");
      await saveRun(result);
      setRecords(await listRuns(owner));
      await clearState(`result:${owner}`);
      run.clear();
      navigate("/real/routes");
      notice(
        "기기에 저장했어요. 계정 동기화 버튼으로 다른 기기에도 보관할 수 있어요.",
      );
    } finally {
      saving.current = false;
    }
  }
  async function synchronize() {
    if (!user || !cloud)
      throw new Error("로그인 후 계정에 동기화할 수 있어요.");
    const who = owner;
    const remote = await syncRuns(who, await listRuns(who));
    const remoteIds = new Set(remote.map((r) => r.id));
    for (const r of await listRuns(who))
      if (r.synced && !remoteIds.has(r.id)) await deleteRun(r.id);
    for (const r of remote) await saveRun(r);
    if (ownerRef.current === who) setRecords(await listRuns(who));
    notice("기록을 계정에 동기화했어요.");
  }
  async function publish(record: RunRecord) {
    if (!cloud || !user) throw new Error("로그인 후 코스를 공개할 수 있어요.");
    if (!record.route || !record.complete)
      throw new Error("경로를 완료한 기록만 코스로 공개할 수 있어요.");
    if (
      !confirm(
        "출발지·목적지와 경로가 다른 사람에게 공개됩니다. 이 코스를 공개할까요?",
      )
    )
      return;
    const { error } = await cloud.from("public_routes").upsert({
      id: record.id,
      user_id: owner,
      title: record.title,
      region: profile.region,
      route: record.route,
    });
    if (error) throw error;
    setPublicItems(await publicRoutes(profile.region));
    notice("코스를 공개했어요. 인기 코스에서 공개 취소할 수 있어요.");
  }
  const grouped = [...new Set(records.map((r) => r.routeKey))].map((key) => ({
    key,
    sessions: records.filter((r) => r.routeKey === key),
  }));
  const displayed = selectedKey
    ? records.filter((r) => r.routeKey === selectedKey)
    : records;
  const previous = result
    ? records.filter(
        (r) =>
          r.routeKey === result.routeKey && r.complete && r.id !== result.id,
      )
    : [];
  const best = previous.length
    ? Math.min(...previous.map((r) => r.elapsedSec))
    : null;
  const isBest =
    !!result?.complete && best !== null && result.elapsedSec < best;
  const nav = (
    <nav className="real-nav" aria-label="주 메뉴">
      {[
        ["home", "⌂", "홈"],
        ["routes", "↗", "나의 루트"],
        ["settings", "⚙", "설정"],
      ].map(([p, icon, label]) => (
        <button
          key={p}
          aria-current={page === p ? "page" : undefined}
          onClick={() => go(p)}
        >
          <span>{icon}</span>
          {label}
        </button>
      ))}
    </nav>
  );
  let content;
  if (page === "legal")
    content = (
      <section>
        <h1>이용약관·개인정보 안내</h1>
        <p>
          현재 배포본은 개발 검증용입니다. 정식 공개 전 운영자 정보, 보관·파기
          기간, 처리위탁과 국외 이전 등 실제 운영에 맞는 정책을 게시해야 합니다.
        </p>
        <p>
          기기 기록은 이 브라우저에 저장됩니다. 계정 동기화를 누르면 위치 경로와
          운동 기록이 계정 서버에 저장됩니다. 코스 공개는 별도 버튼으로 요청한
          경로만 공개합니다.
        </p>
        <p>
          신호 예측은 통행 허가가 아닙니다. 횡단할 때 실제 보행신호와 현장을
          확인하세요.
        </p>
        <button onClick={() => go("home")}>돌아가기</button>
      </section>
    );
  else if (!authReady || !loaded)
    content = (
      <section className="real-loading">
        <div className="runner-mark">
          <RunnerLogo />
        </div>
        <p>FLOW RUN을 준비하고 있어요.</p>
      </section>
    );
  else if ((!user && !guest) || page === "auth")
    content = (
      <Auth
        recovering={recovering}
        notice={notice}
        onGuest={() => {
          setGuest(true);
          sessionStorage.setItem("flow-real-guest", "yes");
          go("home");
        }}
      />
    );
  else if (!profile.onboarded)
    content = (
      <section>
        <p className="eyebrow">WELCOME TO FLOW RUN</p>
        <h1>
          어디에서
          <br />
          달려볼까요?
        </h1>
        <label>
          지역
          <select
            value={profile.region}
            onChange={(e) => setProfile({ ...profile, region: e.target.value })}
          >
            {regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <p className="muted">
          지역은 코스 분류에 사용해요. 신호 예측 지원 여부는 별도로 확인합니다.
        </p>
        <label>
          닉네임
          <input
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="2~20자"
          />
        </label>
        <label>
          평균 페이스 (초/km)
          <input
            type="number"
            min={120}
            max={1800}
            value={pace}
            onChange={(e) => setPace(Number(e.target.value))}
          />
        </label>
        <p>{paceLabel(pace)}/km</p>
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await updateProfile({
                ...profile,
                nickname: nickname.trim(),
                pace,
                onboarded: true,
              });
              go("home");
            })
          }
        >
          시작하기
        </button>
      </section>
    );
  else if (page === "loading")
    content = (
      <section className="real-loading">
        <div className="runner-mark">
          <RunnerLogo />
        </div>
        <h2>루트를 구상하고 있어요.</h2>
        <p>실제 보행 경로와 방향 전환을 비교하고 있어요.</p>
        <button
          onClick={() => {
            request.current?.abort();
            go("home");
          }}
        >
          취소
        </button>
      </section>
    );
  else if (page === "recommend")
    content = route ? (
      <section>
        <p className="eyebrow">YOUR ROUTE</p>
        <h1>
          이 루트로
          <br />
          가시겠어요?
        </h1>
        <RealMap coordinates={route.coordinates} fitToken={fit} />
        <div className="stats">
          <div>
            <strong>{(route.distanceM / 1000).toFixed(2)}</strong>
            <small>km</small>
          </div>
          <div>
            <strong>{paceLabel(pace)}</strong>
            <small>입력 페이스 /km</small>
          </div>
          <div>
            <strong>{timeLabel((route.distanceM / 1000) * pace)}</strong>
            <small>대기 제외 예상</small>
          </div>
        </div>
        <article>
          <h2>{route.name}</h2>
          <p>방향 전환 약 {route.sharpTurns}회 · 신호 대기 예측 불가</p>
          <p className="muted">
            실제 보행 후보 중 거리 증가와 급격한 방향 전환을 비교했어요.
            횡단보도 방향과 신호계획을 검증하기 전에는 ‘신호가 없다’고 판단하지
            않아요.
          </p>
          {profile.avoidStairs && <p>계단 제외 옵션으로 조회했어요.</p>}
        </article>
        <button className="primary" onClick={() => go("ready")}>
          예, 이 루트로 갈게요
        </button>
        <button
          className="secondary"
          onClick={() => {
            if (candidate + 1 < routes.length) setCandidate(candidate + 1);
            else
              notice(
                "같은 조건을 만족하는 다른 후보가 없어요. 출발지·경유지 또는 우회 범위를 조정해 주세요.",
              );
          }}
        >
          아니요, 다른 루트 보기
        </button>
        <button onClick={() => go("home")}>조건 수정</button>
      </section>
    ) : (
      <section>
        <p>경로를 먼저 찾아주세요.</p>
        <button onClick={() => go("home")}>홈으로</button>
      </section>
    );
  else if (page === "ready")
    content = (
      <section>
        <h1>준비되셨나요?</h1>
        <RealMap
          coordinates={route?.coordinates ?? emptyCoords}
          position={position}
        />
        <p>
          출발지에 도착한 뒤 시작해 주세요. 버튼을 누른 시점부터 실제 위치와
          시간을 기록해요.
        </p>
        <p className="muted">
          횡단보도 앞에서 출발한다면 실제 보행신호를 확인한 뒤 시작하세요. 다른
          신호가 자동으로 맞춰지는 것은 아니에요.
        </p>
        <button
          className="primary"
          disabled={busy || !route}
          onClick={() => void action(() => startRun(route))}
        >
          러닝 시작
        </button>
        <button onClick={() => go("recommend")}>경로 다시 보기</button>
      </section>
    );
  else if (page === "run")
    content = run.live ? (
      <section>
        <div className="section-title">
          <h1>
            {run.live.phase === "paused"
              ? "잠시 쉬는 중"
              : "내 페이스로 달리는 중"}
          </h1>
          <span className="live-dot">GPS</span>
        </div>
        <RealMap
          coordinates={run.live.route?.coordinates ?? emptyCoords}
          segments={
            run.live.route ? undefined : trackSegments(run.live.track.fixes)
          }
          position={run.fix?.coord ?? run.live.track.fixes.at(-1)?.coord}
          fitToken={fit}
        />
        <button onClick={() => setFit(fit + 1)}>전체 경로 보기</button>
        {run.error && <p role="status">{run.error}</p>}
        <div className="stats">
          <div>
            <strong>{(run.live.track.distanceM / 1000).toFixed(2)}</strong>
            <small>기록 거리 km</small>
          </div>
          <div>
            <strong>{timeLabel(run.live.activeSec)}</strong>
            <small>운동 시간 · 대기 포함</small>
          </div>
          <div>
            <strong>
              {paceLabel(
                run.live.track.distanceM >= 50
                  ? run.live.activeSec / (run.live.track.distanceM / 1000)
                  : null,
              )}
            </strong>
            <small>평균 페이스 /km</small>
          </div>
        </div>
        <article>
          <p>수동 일시정지 {timeLabel(run.live.manualPauseSec)}</p>
          <p>
            GPS 정지 추정 {Math.round(run.live.track.stoppedSec)}초 · 수신 공백{" "}
            {Math.round(run.live.track.gapSec)}초
          </p>
          <small>
            정지 추정은 신호 대기와 구분됩니다. 신호 정보·다음 횡단 지점은 아직
            검증되지 않았어요.
          </small>
        </article>
        <div className="button-row">
          <button
            className="secondary"
            disabled={run.live.phase === "ended"}
            onClick={() =>
              run.live?.phase === "paused" ? run.resume() : run.pause()
            }
          >
            {run.live.phase === "paused" ? "계속하기" : "일시정지"}
          </button>
          <button
            className="primary"
            disabled={busy || run.live.phase === "ended"}
            onClick={() => void action(finish)}
          >
            러닝 종료
          </button>
        </div>
      </section>
    ) : (
      <section>
        <p>진행 중인 러닝이 없어요.</p>
        <button onClick={() => go("home")}>홈으로</button>
      </section>
    );
  else if (page === "result")
    content = result ? (
      <section>
        <p className="eyebrow">RUN COMPLETE</p>
        <h1>{isBest ? "새로운 최고 기록이에요!" : "오늘도 수고하셨어요."}</h1>
        <RealMap
          coordinates={emptyCoords}
          segments={trackSegments(result.track.fixes)}
        />
        <div className="stats">
          <div>
            <strong>{(result.track.distanceM / 1000).toFixed(2)}</strong>
            <small>기록 거리 km</small>
          </div>
          <div>
            <strong>{timeLabel(result.elapsedSec)}</strong>
            <small>전체 경과시간</small>
          </div>
          <div>
            <strong>
              {paceLabel(
                result.track.distanceM >= 10
                  ? result.activeSec / (result.track.distanceM / 1000)
                  : null,
              )}
            </strong>
            <small>운동 평균 페이스 /km</small>
          </div>
        </div>
        <article>
          <p>
            {result.complete ? "완주 추정" : "부분 기록 · 최고 기록 비교 제외"}
          </p>
          <p>
            운동 {timeLabel(result.activeSec)} · 수동 일시정지{" "}
            {timeLabel(result.manualPauseSec)}
          </p>
          <p>
            GPS 정지 추정 {Math.round(result.track.stoppedSec)}초 · 신호 대기
            확인 불가
          </p>
          {best !== null && result.complete && (
            <p>
              이전 최고보다 {Math.round(Math.abs(result.elapsedSec - best))}초{" "}
              {result.elapsedSec < best ? "빨라졌어요." : "더 걸렸어요."}
            </p>
          )}
        </article>
        <label>
          루트 제목
          <input
            maxLength={80}
            value={result.title}
            onChange={(e) => setResult({ ...result, title: e.target.value })}
          />
        </label>
        <button onClick={() => downloadJson("flow-run-result.json", result)}>
          결과 JSON 내보내기
        </button>
        <button
          className="primary"
          disabled={busy || !result.title.trim()}
          onClick={() => void action(saveResult)}
        >
          나의 루트에 저장
        </button>
        <button
          onClick={() =>
            void action(async () => {
              if (!confirm("저장하지 않고 나갈까요?")) return;
              await clearState(`result:${owner}`);
              run.clear();
              setResult(null);
              go("home");
            })
          }
        >
          저장하지 않기
        </button>
      </section>
    ) : (
      <section>
        <p>저장 전 결과가 있으면 복구할 수 있어요.</p>
        <button
          onClick={() =>
            void action(async () => {
              const r = await readState<RunRecord>(`result:${owner}`);
              if (r) setResult(r);
              else notice("복구할 결과가 없어요.");
            })
          }
        >
          결과 복구
        </button>
      </section>
    );
  else if (page === "routes")
    content = (
      <section>
        <div className="section-title">
          <h1>나의 루트</h1>
          <button
            disabled={busy || !user}
            onClick={() => void action(synchronize)}
          >
            계정 동기화
          </button>
        </div>
        <p className="muted">
          {user
            ? "기기 저장 후 동기화 · 과거 기록은 날짜별로 보관해요."
            : "이 기기에 저장된 기록 · 브라우저 데이터 삭제 시 사라질 수 있어요."}
        </p>
        {grouped.length === 0 && (
          <article>
            <h2>첫 번째 러닝을 기다려요.</h2>
            <button onClick={() => go("home")}>달리러 가기</button>
          </article>
        )}
        {grouped.map((g) => {
          const r = g.sessions[0];
          const completed = g.sessions.filter((s) => s.complete);
          return (
            <button
              className="route-row"
              key={g.key}
              onClick={() => {
                setSelectedKey(g.key);
                go("history");
              }}
            >
              <Thumbnail route={r.route} />
              <span>
                <strong>{r.title}</strong>
                <small>
                  {(r.track.distanceM / 1000).toFixed(2)}km ·{" "}
                  {g.sessions.length}회
                </small>
                <small>
                  최근 {timeLabel(r.elapsedSec)}
                  {completed.length
                    ? ` · 최고 ${timeLabel(Math.min(...completed.map((s) => s.elapsedSec)))}`
                    : ""}
                </small>
              </span>
            </button>
          );
        })}
      </section>
    );
  else if (page === "history")
    content = (
      <section>
        <h1>러닝 기록</h1>
        {displayed.map((r) => (
          <article key={r.id}>
            <div className="route-row">
              <Thumbnail route={r.route} />
              <div>
                <h2>{r.title}</h2>
                <small>{new Date(r.startedAt).toLocaleString("ko-KR")}</small>
                <p>
                  {(r.track.distanceM / 1000).toFixed(2)}km ·{" "}
                  {timeLabel(r.elapsedSec)} ·{" "}
                  {r.complete ? "완주 추정" : "부분 기록"}
                </p>
                <small>{r.synced ? "계정 동기화됨" : "기기에 저장됨"}</small>
              </div>
            </div>
            <div className="button-row">
              <button
                onClick={() => {
                  if (!r.route)
                    return notice("자유 러닝은 고정 경로가 없어요.");
                  setRoutes([r.route]);
                  setCandidate(0);
                  go("recommend");
                }}
              >
                다시 달리기
              </button>
              <button
                onClick={() =>
                  void action(async () => {
                    const title = prompt("새 루트 제목", r.title)?.trim();
                    if (!title) return;
                    for (const s of records.filter(
                      (s) => s.routeKey === r.routeKey,
                    ))
                      await saveRun({
                        ...s,
                        title: title.slice(0, 80),
                        synced: false,
                      });
                    setRecords(await listRuns(owner));
                  })
                }
              >
                제목 수정
              </button>
              <button
                disabled={busy}
                onClick={() => void action(() => publish(r))}
              >
                코스 공개
              </button>
            </div>
            <button
              className="danger"
              onClick={() =>
                void action(async () => {
                  if (
                    !confirm(
                      "이 날짜의 기록을 삭제할까요? 공개한 코스는 인기 코스에서 별도로 취소할 수 있어요.",
                    )
                  )
                    return;
                  if (user && cloud) {
                    const { error } = await cloud
                      .from("runs")
                      .delete()
                      .eq("id", r.id)
                      .eq("user_id", owner);
                    if (error) throw error;
                  }
                  await deleteRun(r.id);
                  setRecords(await listRuns(owner));
                })
              }
            >
              이 기록 삭제
            </button>
          </article>
        ))}
        <button onClick={() => go("routes")}>나의 루트로</button>
      </section>
    );
  else if (page === "popular")
    content = (
      <section>
        <h1>{profile.region}의 인기 루트</h1>
        {!publicItems.length && (
          <article>
            아직 공개된 코스가 없어요. 가상의 인기 수를 표시하지 않습니다.
          </article>
        )}
        {publicItems.map((p) => (
          <article key={p.id}>
            <div className="route-row">
              <Thumbnail route={p.route} />
              <div>
                <h2>{p.title}</h2>
                <p>
                  {(p.route.distanceM / 1000).toFixed(2)}km · 공감 {p.likes}
                </p>
              </div>
            </div>
            <div className="button-row">
              <button
                onClick={() => {
                  setRoutes([p.route]);
                  setCandidate(0);
                  go("recommend");
                }}
              >
                경로 보기
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    if (!cloud || !user)
                      throw new Error("로그인 후 공감할 수 있어요.");
                    const existing = await cloud
                      .from("route_likes")
                      .select("route_id")
                      .eq("route_id", p.id)
                      .eq("user_id", owner)
                      .maybeSingle();
                    if (existing.error) throw existing.error;
                    const response = existing.data
                      ? await cloud
                          .from("route_likes")
                          .delete()
                          .eq("route_id", p.id)
                          .eq("user_id", owner)
                      : await cloud
                          .from("route_likes")
                          .insert({ route_id: p.id, user_id: owner });
                    if (response.error) throw response.error;
                    setPublicItems(await publicRoutes(profile.region));
                  })
                }
              >
                공감 / 취소
              </button>
              {p.user_id === owner && (
                <button
                  onClick={() =>
                    void action(async () => {
                      if (!cloud || !confirm("코스 공개를 취소할까요?")) return;
                      const { error } = await cloud
                        .from("public_routes")
                        .delete()
                        .eq("id", p.id)
                        .eq("user_id", owner);
                      if (error) throw error;
                      setPublicItems(await publicRoutes(profile.region));
                    })
                  }
                >
                  공개 취소
                </button>
              )}
            </div>
          </article>
        ))}
      </section>
    );
  else if (page === "pace")
    content = (
      <section>
        <h1>내 페이스 계산</h1>
        <label>
          거리 (km)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={calcKm}
            onChange={(e) => setCalcKm(e.target.value)}
          />
        </label>
        <label>
          걸린 시간 (분)
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={calcMin}
            onChange={(e) => setCalcMin(e.target.value)}
          />
        </label>
        <div className="hero-number">
          {paceLabel(
            Number(calcKm) > 0 ? (Number(calcMin) * 60) / Number(calcKm) : null,
          )}
          <small>/km</small>
        </div>
        <div className="button-row">
          {[5, 10, 21.0975, 42.195].map((km) => (
            <button key={km} onClick={() => setCalcKm(String(km))}>
              {km}km
            </button>
          ))}
        </div>
        <button
          className="primary"
          onClick={() =>
            void action(async () => {
              const p = Math.round((Number(calcMin) * 60) / Number(calcKm));
              if (!validPace(p))
                throw new Error("거리와 시간을 확인해 주세요.");
              setPace(p);
              await updateProfile({ ...profile, pace: p });
              go("home");
            })
          }
        >
          내 평균 페이스로 저장
        </button>
        {route && (
          <button onClick={() => setCalcKm(String(route.distanceM / 1000))}>
            선택한 경로 거리 사용
          </button>
        )}
      </section>
    );
  else if (page === "settings")
    content = (
      <section>
        <h1>설정</h1>
        <article>
          <h2>내 프로필</h2>
          <label>
            닉네임
            <input
              value={nickname}
              maxLength={20}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <label>
            지역
            <select
              value={profile.region}
              onChange={(e) =>
                setProfile({ ...profile, region: e.target.value })
              }
            >
              {regions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            허용 우회 거리
            <select
              value={profile.detour}
              onChange={(e) =>
                setProfile({ ...profile, detour: Number(e.target.value) })
              }
            >
              <option value={0.05}>5% 이내</option>
              <option value={0.1}>10% 이내</option>
              <option value={0.15}>15% 이내</option>
            </select>
          </label>
          {(["avoidStairs", "voice", "vibration", "wake"] as const).map(
            (k, i) => (
              <label className="check" key={k}>
                <input
                  type="checkbox"
                  checked={profile[k]}
                  onChange={(e) =>
                    setProfile({ ...profile, [k]: e.target.checked })
                  }
                />
                {
                  [
                    "계단 제외 경로만 요청",
                    "시작 음성 안내",
                    "시작 진동",
                    "러닝 중 화면 켜짐 유지",
                  ][i]
                }
              </label>
            ),
          )}
          <small>
            우회 최대 500m · 육교·골목 상세 회피는 보행망 속성 연결 후
            지원합니다.
          </small>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await updateProfile({ ...profile, nickname: nickname.trim() });
                notice("설정을 저장했어요.");
              })
            }
          >
            설정 저장
          </button>
          <button onClick={() => go("pace")}>평균 페이스 수정</button>
        </article>
        <article>
          <h2>기록·위치</h2>
          <button
            onClick={() =>
              void action(async () => {
                const p = await locate();
                notice(`현재 위치 확인 · 오차 약 ${Math.round(p.accuracy)}m`);
              })
            }
          >
            위치 권한 확인
          </button>
          <button
            onClick={() => downloadJson("flow-run-records.json", records)}
          >
            내 기록 JSON 내보내기
          </button>
          <button
            disabled={!user || busy}
            onClick={() => void action(synchronize)}
          >
            계정 기록 동기화
          </button>
          <button
            className="danger"
            onClick={() =>
              void action(async () => {
                if (
                  !confirm(
                    "내 운동 기록 전체를 삭제할까요? 공개 코스는 별도로 공개 취소해 주세요.",
                  )
                )
                  return;
                if (cloud && user) {
                  const { error } = await cloud
                    .from("runs")
                    .delete()
                    .eq("user_id", owner);
                  if (error) throw error;
                }
                for (const r of records) await deleteRun(r.id);
                setRecords([]);
                notice("운동 기록을 삭제했어요.");
              })
            }
          >
            운동 기록 전체 삭제
          </button>
        </article>
        <article>
          <h2>API 연결 상태</h2>
          <p>
            지도:{" "}
            {import.meta.env.VITE_MAPTILER_KEY
              ? "키 설정됨 · 화면에서 수신 확인"
              : "키 미설정"}
          </p>
          <p>장소 검색: {status?.places ? "키 설정됨" : "미설정"}</p>
          <p>보행 경로: {status?.routes ? "키 설정됨" : "미설정"}</p>
          <p>
            서울 신호:{" "}
            {status?.seoulSignals ? "키 설정됨 · 응답 검증 필요" : "미설정"}
          </p>
          <p>도착 시점 신호 예측: 검증 대기</p>
          <label>
            연결 확인할 서울 교차로 ID
            <input
              inputMode="numeric"
              value={signalId}
              onChange={(e) => setSignalId(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !status?.seoulSignals}
            onClick={() =>
              void action(async () =>
                setSignalResult(
                  await api(
                    `signals/seoul?itstId=${encodeURIComponent(signalId)}&service=phase`,
                  ),
                ),
              )
            }
          >
            신호 응답 확인
          </button>
          {signalResult !== null && (
            <details>
              <summary>현재 상태 원문 · 통행 안내 아님</summary>
              <pre>{JSON.stringify(signalResult, null, 2)}</pre>
            </details>
          )}
        </article>
        <article>
          <button onClick={() => go("legal")}>이용약관·개인정보 안내</button>
          {user ? (
            <button
              onClick={() =>
                void action(async () => {
                  if (cloud) {
                    const { error } = await cloud.auth.signOut();
                    if (error) throw error;
                  }
                  setGuest(false);
                  sessionStorage.removeItem("flow-real-guest");
                  go("auth");
                })
              }
            >
              로그아웃
            </button>
          ) : (
            <button onClick={() => go("auth")}>로그인 / 회원가입</button>
          )}
          {user && (
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  if (
                    !cloud ||
                    prompt(
                      "계정과 모든 계정 기록·공개 코스를 영구 삭제하려면 탈퇴를 입력하세요.",
                    ) !== "탈퇴"
                  )
                    return;
                  const { error } = await cloud.rpc("delete_my_account");
                  if (error) throw error;
                  for (const r of await listRuns(owner)) await deleteRun(r.id);
                  await clearState(`profile:${owner}`);
                  await clearState(`active:${owner}`);
                  await clearState(`result:${owner}`);
                  await cloud.auth.signOut({ scope: "local" });
                  setUser(null);
                  setGuest(false);
                  sessionStorage.removeItem("flow-real-guest");
                  navigate("/real/auth");
                  notice("계정을 삭제했습니다.");
                })
              }
            >
              계정 탈퇴
            </button>
          )}
        </article>
      </section>
    );
  else
    content = (
      <section>
        <p className="muted">{profile.nickname}님, 반갑습니다.</p>
        <h1>
          오늘 어디로
          <br />
          달려볼까요?
        </h1>
        <p className="eyebrow">{profile.region} · YOUR OWN FLOW</p>
        {result && (
          <article>
            <h2>저장하지 않은 러닝 결과가 있어요.</h2>
            <button onClick={() => go("result")}>결과 확인·저장</button>
          </article>
        )}
        {recovery && (
          <article>
            <h2>이전 러닝 기록이 남아 있어요.</h2>
            <p>
              앱을 닫은 동안의 거리는 더하지 않아요. 일시정지 상태로 복구합니다.
            </p>
            <button
              onClick={() => {
                runOwner.current = owner;
                run.recover(recovery);
                setRecovery(null);
                navigate("/real/run");
              }}
            >
              진행 기록 복구
            </button>
            <button
              onClick={() =>
                void action(async () => {
                  if (!confirm("미완료 기록을 버릴까요?")) return;
                  await clearState(`active:${owner}`);
                  setRecovery(null);
                })
              }
            >
              버리기
            </button>
          </article>
        )}
        <div className="section-title">
          <h2>유행하는 루트</h2>
          <button onClick={() => go("popular")}>더 보기 ↗</button>
        </div>
        {publicItems.length ? (
          <div className="public-strip">
            {publicItems.slice(0, 3).map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setRoutes([p.route]);
                  setCandidate(0);
                  go("recommend");
                }}
              >
                <Thumbnail route={p.route} />
                <strong>{p.title}</strong>
                <small>
                  {(p.route.distanceM / 1000).toFixed(2)}km · 공감 {p.likes}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <article className="muted">
            아직 공개된 코스가 없어요. 첫 코스를 기록해 보세요.
          </article>
        )}
        <div className="section-title">
          <h2>직접 설정</h2>
          <button disabled={busy} onClick={() => void action(usePosition)}>
            현재 위치
          </button>
        </div>
        <article>
          <PlaceInput label="출발지" value={origin} onChange={setOrigin} />
          <PlaceInput
            label={loop ? "반환점" : "목적지"}
            value={destination}
            onChange={setDestination}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />
            출발지로 돌아오기
          </label>
          <label>
            평균 페이스
            <div className="pace-input">
              <input
                aria-label="페이스 분"
                type="number"
                min={2}
                max={30}
                value={Math.floor(pace / 60)}
                onChange={(e) =>
                  setPace(Number(e.target.value) * 60 + (pace % 60))
                }
              />
              <span>분</span>
              <input
                aria-label="페이스 초"
                type="number"
                min={0}
                max={59}
                value={pace % 60}
                onChange={(e) =>
                  setPace(
                    Math.floor(pace / 60) * 60 +
                      Math.min(59, Math.max(0, Number(e.target.value))),
                  )
                }
              />
              <span>초 /km</span>
            </div>
          </label>
          <button
            onClick={() => {
              setShowVia(!showVia);
              if (showVia) setVia(null);
            }}
          >
            {showVia ? "경유지 제거" : "꼭 지나고 싶은 장소 추가"}
          </button>
          {showVia && (
            <PlaceInput label="경유지" value={via} onChange={setVia} />
          )}
        </article>
        <div className="button-row">
          <button onClick={() => setPick(pick === "origin" ? null : "origin")}>
            지도에서 출발지 선택
          </button>
          <button
            onClick={() =>
              setPick(pick === "destination" ? null : "destination")
            }
          >
            지도에서 목적지 선택
          </button>
        </div>
        {pick && (
          <article>
            <p>
              {pick === "origin" ? "출발지" : "목적지"}를 지도에서 눌러주세요.
            </p>
            <RealMap
              position={position}
              onPick={(coord) => {
                const p: Place = {
                  id: `map:${coord.join(",")}`,
                  name: `지도 선택 (${coord[1].toFixed(4)}, ${coord[0].toFixed(4)})`,
                  coord,
                };
                if (pick === "origin") setOrigin(p);
                else setDestination(p);
                setPick(null);
              }}
            />
            <button onClick={() => setPick(null)}>닫기</button>
          </article>
        )}
        <button
          className="primary"
          disabled={busy}
          onClick={() => void action(findRoutes)}
        >
          루트 찾기
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void action(() => startRun(null))}
        >
          경로 없이 자유 러닝 시작
        </button>
        <button onClick={() => go("pace")}>내 페이스 계산하기</button>
        <div className="section-title">
          <h2>나의 루트</h2>
          <button onClick={() => go("routes")}>전체 보기 ↗</button>
        </div>
        {grouped.slice(0, 2).map((g) => (
          <button
            className="route-row"
            key={g.key}
            onClick={() => {
              setSelectedKey(g.key);
              go("history");
            }}
          >
            <Thumbnail route={g.sessions[0].route} />
            <span>
              <strong>{g.sessions[0].title}</strong>
              <small>{g.sessions.length}회 달렸어요.</small>
            </span>
          </button>
        ))}
      </section>
    );
  return (
    <div className="real-shell">
      <header className="real-header">
        <button onClick={() => go("home")} className="brand">
          <RunnerLogo /> FLOW RUN
        </button>
        <button onClick={() => go("settings")}>{profile.region}⌄</button>
      </header>
      <main>
        {message && (
          <div className="real-notice" role="status">
            {message}
            <button aria-label="알림 닫기" onClick={() => setMessage("")}>
              ×
            </button>
          </div>
        )}
        {content}
      </main>
      {profile.onboarded &&
        (guest || user) &&
        !["run", "loading", "auth"].includes(page) &&
        nav}
    </div>
  );
}
