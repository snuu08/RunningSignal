import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { planStopsFromDraft, popularToDraft, saveProfile, useApp } from "../../app/context.tsx";
import {
  AppHeader,
  BottomNav,
  RegionPill,
  SectionHeader,
  SoftPill,
} from "../../components/chrome.tsx";
import { IconCheck, IconChevron, IconClock, IconMore, IconPin } from "../../components/Icons.tsx";
import { MapRenderer, MapThumb } from "../../components/map/MapRenderer.tsx";
import { Sheet } from "../../components/Sheet.tsx";
import { Button, Field, TextInput } from "../../components/ui.tsx";
import { isDemoMode } from "../../config/mode.ts";
import { REGIONS, regionLabel } from "../../data/demo/regions.ts";
import { NETWORKS } from "../../data/demo/networks.ts";
import { geometryFromDirectedIds } from "../../domain/pathfinding.ts";
import {
  displayRoutePaceSeconds,
  formatDistanceKm,
  formatPaceMarks,
  formatPaceSpoken,
  canRunWithoutPace,
  defaultGoalPaceSeconds,
  emptyPaceBook,
  hasAnySavedPace,
  secondsToPaceParts,
  validatePace,
} from "../../domain/pace.ts";
import type { PlaceRef, RegionId, SavedRoute } from "../../domain/models.ts";
import { PaceCalculator } from "../pace/PaceCalculator.tsx";
import { PaceMinSecFields } from "../pace/inputs.tsx";

export function HomeScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const { account, profile, providers, draft, setDraft } = ctx;
  const regionId = profile?.regionId ?? "seoul";
  const network = providers.places.getNetwork(regionId);
  const cards = providers.catalog.list(regionId);
  if (account && isDemoMode()) {
    providers.runs.ensureDemoSample(account.id, regionId);
  }
  const routes = account ? providers.runs.listRoutes(account.id) : [];
  const [sheet, setSheet] = useState<"place" | "pace" | "region" | "waypoint" | null>(null);
  const [paceView, setPaceView] = useState<"edit" | "calc" | "book" | "routes">("edit");
  const [waypointIndex, setWaypointIndex] = useState<number | null>(null);
  const defaultGoalPace = defaultGoalPaceSeconds(profile?.paces);

  useEffect(() => {
    if (!defaultGoalPace) return;
    setDraft((prev) => {
      if (prev.paceTouched || prev.paceSkipped) return prev;
      if (prev.paceSeconds === defaultGoalPace) return prev;
      return { ...prev, paceSeconds: defaultGoalPace };
    });
  }, [defaultGoalPace, setDraft]);
  const [searchTarget, setSearchTarget] = useState<"origin" | "destination" | "waypoint">("origin");
  const [query, setQuery] = useState("");
  const [paceError, setPaceError] = useState<string | null>(null);

  const sortedCards = useMemo(() => {
    if (!account) return cards;
    return [...cards].sort(
      (a, b) =>
        providers.catalog.displayCount(account.id, b) -
        providers.catalog.displayCount(account.id, a),
    );
  }, [cards, account, providers.catalog]);

  const results = providers.places.search(regionId, query);

  const applyPlace = (place: PlaceRef) => {
    setDraft((prev) => {
      if (searchTarget === "origin") return { ...prev, origin: place };
      if (searchTarget === "destination") return { ...prev, destination: place };
      if (waypointIndex !== null) {
        return {
          ...prev,
          waypoints: prev.waypoints.map((item, index) => (index === waypointIndex ? place : item)),
        };
      }
      return { ...prev, waypoints: [...prev.waypoints, place] };
    });
    setWaypointIndex(null);
    setSheet(null);
    setQuery("");
  };

  const findRoute = () => {
    if (!canRunWithoutPace(draft.paceSeconds, draft.paceSkipped)) {
      setPaceError("이번 러닝 목표 페이스를 입력하거나, 시간을 입력하지 않고 그냥 달릴래요를 눌러 주세요.");
      return;
    }
    if (draft.paceSeconds !== null) {
      const parts = secondsToPaceParts(draft.paceSeconds);
      const err = validatePace(parts);
      setPaceError(err);
      if (err) return;
    }
    if (
      !draft.loop &&
      draft.origin &&
      draft.destination &&
      draft.origin.nodeId === draft.destination.nodeId &&
      draft.waypoints.length === 0
    ) {
      setPaceError("출발과 도착이 같습니다. 순환을 켜거나 다른 지점을 골라 주세요.");
      return;
    }
    if (!planStopsFromDraft(draft)) {
      setPaceError(
        draft.loop
          ? "순환 코스는 중간 목적지 또는 도착지를 하나 골라 주세요."
          : "출발과 도착을 선택해 주세요.",
      );
      return;
    }
    navigate("/loading");
  };

  return (
    <div className="app-page">
      <AppHeader
        right={
          <RegionPill label={regionLabel(regionId)} onClick={() => setSheet("region")} />
        }
      />
      <div className="page-body has-tab">
        <div className="hello">{profile?.nickname ?? "러너"}님, 반갑습니다</div>
        <h1 className="h1">오늘 어디로 달릴까요?</h1>
        <div style={{ marginTop: 10 }}>
          <SoftPill>데모</SoftPill>
        </div>

        <section className="section">
          <p className="tiny muted">목적지나, 원하는 페이스를 정하지 않고 Just RUN!</p>
          <div style={{ marginTop: 10 }}>
            <Button
              variant="primary"
              onClick={() => {
                if (!canRunWithoutPace(draft.paceSeconds, draft.paceSkipped)) {
                  setPaceError("이번 러닝 목표 페이스를 입력하거나, 시간을 입력하지 않고 그냥 달릴래요를 눌러 주세요.");
                  return;
                }
                setPaceError(null);
                ctx.setJustRun(true);
                navigate("/just-run");
              }}
            >
              Just RUN!
            </Button>
          </div>
        </section>

        <section className="section section-split">
          <div className="compact-panel">
            <button
              type="button"
              className="compact-row"
              onClick={() => {
                setPaceView("edit");
                setSheet("pace");
              }}
            >
              <IconClock size={18} />
              <span className="compact-label">이번 러닝 목표 페이스</span>
              <span className="compact-value">
                {draft.paceSkipped
                  ? "그냥 달리기"
                  : draft.paceSeconds === null
                    ? "입력"
                    : formatPaceMarks(draft.paceSeconds)}
              </span>
              <IconChevron size={16} />
            </button>
          </div>
        </section>

        <section className="section">
          <SectionHeader
            title="유행하는 루트"
            action="더보기 ›"
            onAction={() => navigate("/popular")}
          />
          <div className="trend-row">
            {sortedCards.map((card) => (
              <button
                key={card.cardId}
                className="preview-card"
                onClick={() => {
                  setDraft(popularToDraft(card, draft));
                  navigate(`/popular/card/${encodeURIComponent(card.cardId)}`);
                }}
              >
                <MapThumb
                  network={network}
                  route={geometryFromDirectedIds(network, card.directedEdgeIds)}
                />
                <div className="preview-meta">
                  <div className="preview-top">
                    <span>{card.title}</span>
                    <span>{formatDistanceKm(card.lengthM)}</span>
                  </div>
                  <div className="preview-sub">{card.sampleLabel}</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="section">
          <SectionHeader title="직접 설정" />
          <div className="compact-panel">
            <button
              type="button"
              className="compact-row"
              onClick={() => {
                setSearchTarget("origin");
                setQuery(draft.origin?.label ?? "");
                setSheet("place");
              }}
            >
              <IconPin size={18} />
              <span className="compact-label">출발지</span>
              <span className="compact-value">{draft.origin?.label ?? "선택"}</span>
              <IconChevron size={16} />
            </button>
            <button
              type="button"
              className="compact-row"
              onClick={() => {
                setSearchTarget("destination");
                setQuery(draft.destination?.label ?? "");
                setSheet("place");
              }}
            >
              <IconPin size={18} />
              <span className="compact-label">도착지</span>
              <span className="compact-value">{draft.destination?.label ?? "선택"}</span>
              <IconChevron size={16} />
            </button>
          </div>
          <div className="compact-loop-wrap compact-panel">
            <button
              type="button"
              className="compact-loop"
              aria-pressed={draft.loop}
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  loop: !prev.loop,
                  waypoints: prev.loop ? [] : prev.waypoints,
                }))
              }
            >
              <span className="pace-check" data-checked={draft.loop ? "true" : "false"} aria-hidden>
                {draft.loop ? <IconCheck size={14} /> : null}
              </span>
              순환
            </button>
          </div>
          {draft.loop ? (
            <div className="compact-panel" style={{ marginTop: 8 }}>
              {draft.waypoints.map((place, index) => (
                <button
                  key={`${place.placeId}-${index}`}
                  type="button"
                  className="compact-row"
                  onClick={() => {
                    setWaypointIndex(index);
                    setSheet("waypoint");
                  }}
                >
                  <IconPin size={18} />
                  <span className="compact-label">중간 목적지</span>
                  <span className="compact-value">{place.label}</span>
                  <IconChevron size={16} />
                </button>
              ))}
              <button
                type="button"
                className="compact-row"
                onClick={() => {
                  setWaypointIndex(null);
                  setSearchTarget("waypoint");
                  setQuery("");
                  setSheet("place");
                }}
              >
                <IconPin size={18} />
                <span className="compact-label">중간 목적지</span>
                <span className="compact-value">추가</span>
                <IconChevron size={16} />
              </button>
            </div>
          ) : null}
          <p className="tiny muted" style={{ marginTop: 8 }}>
            순환을 켜면 출발지로 돌아오는 코스에 중간 목적지를 넣을 수 있습니다.
          </p>
          {paceError ? <p className="error">{paceError}</p> : null}
          <div style={{ marginTop: 12 }}>
            <Button variant="primary" onClick={findRoute}>
              루트 찾기
            </Button>
          </div>
        </section>

        <section className="section">
          <SectionHeader title="나의 루트" action="더보기 ›" onAction={() => navigate("/routes")} />
          {routes.length === 0 ? (
            <p className="tiny muted">아직 저장된 루트가 없습니다.</p>
          ) : (
            routes.slice(0, 4).map((route) => <MyRouteRow key={route.routeId} route={route} />)
          )}
        </section>
      </div>
      <BottomNav active="home" />

      {sheet === "region" ? (
        <Sheet title="지역 선택" onClose={() => setSheet(null)}>
          <p className="tiny muted">데모 체험용 목록입니다. 실제 API 지원 도시가 아닙니다.</p>
          {REGIONS.map((r) => (
            <button
              key={r.id}
              className="check-row"
              aria-pressed={r.id === regionId}
              onClick={() => {
                saveProfile(ctx, { regionId: r.id as RegionId });
                setSheet(null);
              }}
            >
              <span>
                {r.label}
                <span className="tiny muted"> · {r.demoLabel}</span>
              </span>
              {r.id === regionId ? "선택됨" : ""}
            </button>
          ))}
        </Sheet>
      ) : null}

      {sheet === "pace" ? (
        <HomePaceSheet
          onClose={() => {
            setPaceView("edit");
            setSheet(null);
          }}
          view={paceView}
          setView={setPaceView}
        />
      ) : null}

      {sheet === "waypoint" && waypointIndex !== null ? (
        <Sheet
          title="중간 목적지"
          onClose={() => {
            setWaypointIndex(null);
            setSheet(null);
          }}
        >
          <div className="stack">
          <p>{draft.waypoints[waypointIndex]?.label}</p>
          <Button
            onClick={() => {
              setSearchTarget("waypoint");
              setQuery(draft.waypoints[waypointIndex]?.label ?? "");
              setSheet("place");
            }}
          >
            다시 고르기
          </Button>
          <Button
            onClick={() => {
              const index = waypointIndex;
              setDraft((prev) => ({
                ...prev,
                waypoints: prev.waypoints.filter((_, i) => i !== index),
              }));
              setWaypointIndex(null);
              setSheet(null);
            }}
          >
            삭제
          </Button>
          <Button
            onClick={() => {
              setWaypointIndex(null);
              setSheet(null);
            }}
          >
            취소
          </Button>
          </div>
        </Sheet>
      ) : null}

      {sheet === "place" ? (
        <Sheet
          title={
            searchTarget === "origin" ? "출발지" : searchTarget === "destination" ? "도착지" : "중간 목적지"
          }
          onClose={() => {
            setWaypointIndex(null);
            setSheet(null);
          }}
        >
          <Field label="장소 검색">
            <TextInput
              value={query}
              placeholder="데모 장소 이름"
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          {results.length === 0 ? (
            <p className="tiny muted">검색 결과가 없습니다. 가상 지도에서 지점을 지정해 주세요.</p>
          ) : (
            results.map((p) => (
              <button key={p.placeId} className="settings-row" onClick={() => applyPlace(p)}>
                {p.label}
              </button>
            ))
          )}
          <Button
            variant="secondary"
            onClick={() => {
              const start = providers.places.demoStart(regionId);
              applyPlace({ ...start, label: "데모 시작 위치" });
            }}
          >
            데모 시작 위치 사용
          </Button>
          <div style={{ height: 220, marginTop: 12 }}>
            <MapRenderer
              network={network}
              origin={draft.origin}
              destination={draft.destination}
              waypoints={draft.waypoints}
              framed
              height={220}
              onSelectPoint={(point) => {
                applyPlace(
                  providers.places.fromPoint(
                    regionId,
                    point,
                    searchTarget === "origin"
                      ? "지도에서 고른 출발"
                      : searchTarget === "destination"
                        ? "지도에서 고른 도착"
                        : "지도에서 고른 중간 목적지",
                  ),
                );
              }}
            />
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function HomePaceSheet({
  onClose,
  view,
  setView,
}: {
  onClose: () => void;
  view: "edit" | "calc" | "book" | "routes";
  setView: (view: "edit" | "calc" | "book" | "routes") => void;
}) {
  const ctx = useApp();
  const navigate = useNavigate();
  const { draft, setDraft, profile, account, providers } = ctx;
  const book = profile?.paces;
  const savedRoutes = account ? providers.runs.listRoutes(account.id) : [];
  const routePaces = savedRoutes.map((route) => {
    const latest = account ? providers.runs.listSessions(account.id, route.routeId)[0] : undefined;
    return { route, pace: displayRoutePaceSeconds(route, latest) };
  }).filter((row) => row.pace !== null);
  const parts = draft.paceSeconds === null ? null : secondsToPaceParts(draft.paceSeconds);
  const [minutes, setMinutes] = useState(parts ? String(parts.minutes) : "");
  const [seconds, setSeconds] = useState(parts ? String(parts.seconds) : "");
  const [error, setError] = useState<string | null>(null);
  const currentRoute =
    draft.origin && draft.destination
      ? {
          origin: draft.origin,
          destination: draft.destination,
          waypoints: draft.loop ? draft.waypoints : [],
        }
      : null;

  const skipGoalPace = () => {
    setDraft((prev) => ({
      ...prev,
      paceSeconds: null,
      paceTouched: true,
      paceSkipped: true,
    }));
    onClose();
  };

  const applyGoal = (paceSeconds: number) => {
    setDraft((prev) => ({ ...prev, paceSeconds, paceTouched: true, paceSkipped: false }));
    const next = secondsToPaceParts(paceSeconds);
    setMinutes(String(next.minutes));
    setSeconds(String(next.seconds));
  };

  return (
    <Sheet
      title={
        view === "calc"
          ? "달린 거리와 시간으로 계산하기"
          : view === "book"
            ? "내 페이스 불러오기"
            : view === "routes"
              ? "나의 루트에서 가져오기"
              : "이번 러닝 목표 페이스"
      }
      onClose={onClose}
    >
      {view === "calc" ? (
        <PaceCalculator
          currentRoute={currentRoute}
          onCancel={() => setView("edit")}
          onApply={(paceSeconds) => {
            applyGoal(paceSeconds);
            setView("edit");
          }}
          onSkipPace={skipGoalPace}
        />
      ) : null}

      {view === "book" ? (
        <div className="stack">
          {hasAnySavedPace(book ?? emptyPaceBook()) ? null : (
            <p className="tiny muted">
              설정에 저장된 페이스가 없습니다. 설정에서 등록한 뒤 불러오거나, 이번 러닝용으로 직접
              입력해 주세요.
            </p>
          )}
          <Button
            onClick={() => {
              onClose();
              navigate("/settings/paces?pick=1");
            }}
          >
            설정 페이스 불러오기
          </Button>
          <Button onClick={() => setView("edit")}>직접 입력</Button>
          <Button onClick={() => setView("edit")}>취소</Button>
        </div>
      ) : null}

      {view === "routes" ? (
        <div className="stack">
          {routePaces.length === 0 ? (
            <p className="tiny muted">
              평균 페이스가 있는 나의 루트가 없습니다. 러닝을 저장한 뒤 다시 가져와 주세요.
            </p>
          ) : (
            routePaces.map(({ route, pace }) => (
              <button
                key={route.routeId}
                type="button"
                className="settings-row"
                onClick={() => {
                  if (pace === null) return;
                  applyGoal(pace);
                  setView("edit");
                }}
              >
                <span>{route.title}</span>
                <span className="tiny muted">{formatPaceSpoken(pace)}</span>
              </button>
            ))
          )}
          <Button onClick={() => setView("edit")}>직접 입력</Button>
          <Button onClick={() => setView("edit")}>취소</Button>
        </div>
      ) : null}

      {view === "edit" ? (
        <div className="stack">
          <p className="tiny muted">
            {draft.paceTouched
              ? "이번 러닝에만 적용됩니다. 저장된 기록은 바뀌지 않습니다."
              : defaultGoalPaceSeconds(book)
                ? "설정하지 않으면 평균 러닝 페이스가 미리 들어갑니다. 이번 러닝에만 적용됩니다."
                : "이번 러닝에만 적용됩니다. 저장된 기록은 바뀌지 않습니다."}
          </p>
          <PaceMinSecFields
            minutes={minutes}
            seconds={seconds}
            onMinutes={setMinutes}
            onSeconds={setSeconds}
          />
          {error ? <p className="error">{error}</p> : null}
          <Button
            onClick={() => {
              setError(null);
              setView("book");
            }}
          >
            내 페이스 불러오기
          </Button>
          <Button
            onClick={() => {
              setError(null);
              setView("routes");
            }}
          >
            나의 루트에서 가져오기
          </Button>
          <Button onClick={() => setView("calc")}>페이스를 모르겠어요</Button>
          <Button onClick={skipGoalPace}>시간을 입력하지 않고, 그냥 달릴래요</Button>
          <Button
            variant="primary"
            onClick={() => {
              const pace = { minutes: Number(minutes), seconds: Number(seconds) };
              const err = validatePace(pace);
              if (err) {
                setError(err);
                return;
              }
              applyGoal(pace.minutes * 60 + pace.seconds);
              onClose();
            }}
          >
            확인
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}

export function MyRouteRow({ route }: { route: SavedRoute }) {
  const ctx = useApp();
  const { account, providers, refresh, pendingRenameRouteId, setPendingRenameRouteId } = ctx;
  const navigate = useNavigate();
  const sessions = account ? providers.runs.listSessions(account.id, route.routeId) : [];
  const latest = sessions[0];
  const paceSeconds = displayRoutePaceSeconds(route, latest);
  const wrapRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(route.title);

  useEffect(() => {
    setTitle(route.title);
  }, [route.title]);

  useEffect(() => {
    if (pendingRenameRouteId !== route.routeId) return;
    setTitle(route.title);
    setEditing(true);
    setPendingRenameRouteId(null);
  }, [pendingRenameRouteId, route.routeId, route.title, setPendingRenameRouteId]);

  useEffect(() => {
    if (editing) {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!menuOpen && !confirmDelete) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen, confirmDelete]);

  const commitRename = () => {
    const next = title.trim();
    if (account && next && next !== route.title) {
      providers.runs.renameRoute(account.id, route.routeId, next);
      refresh();
    } else {
      setTitle(route.title);
    }
    setEditing(false);
  };

  return (
    <div className="history-row" ref={wrapRef}>
      <div className="history-main">
        <button
          type="button"
          className="history-open"
          onClick={() => {
            if (!editing) navigate(`/history/${route.routeId}`);
          }}
        >
          <MapThumb network={NETWORKS[route.regionId]} route={route.geometry} />
        </button>
        <div className="history-mid">
          {editing ? (
            <input
              ref={titleRef}
              className="history-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setTitle(route.title);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="history-title"
              onClick={() => navigate(`/history/${route.routeId}`)}
            >
              {route.title}
            </button>
          )}
          <div className="tiny muted">
            {route.originLabel} → {route.destinationLabel}
            {route.source === "demo" ? " · 데모 샘플" : ""}
          </div>
        </div>
        <button
          type="button"
          className="history-side"
          onClick={() => {
            if (!editing) navigate(`/history/${route.routeId}`);
          }}
        >
          <div>
            <span className="metric-label">평균 페이스 </span>
            <span className="num-accent">{paceSeconds === null ? "--" : formatPaceMarks(paceSeconds)}</span>
          </div>
          <div>
            <span className="metric-label">거리 </span>
            <span className="num-accent">{formatDistanceKm(route.lengthM)}</span>
          </div>
        </button>
      </div>
      <div className="route-menu-wrap">
        <button
          type="button"
          className="icon-btn history-more"
          aria-label="루트 메뉴"
          onClick={() => {
            setConfirmDelete(false);
            setMenuOpen((open) => !open);
          }}
        >
          <IconMore />
        </button>
        {menuOpen ? (
          <div className="route-mini-menu" role="menu">
            <button
              type="button"
              onClick={() => {
                setTitle(route.title);
                setEditing(true);
                setMenuOpen(false);
              }}
            >
              이름 수정
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setConfirmDelete(true);
              }}
            >
              삭제
            </button>
          </div>
        ) : null}
        {confirmDelete ? (
          <div className="route-mini-menu" role="dialog" aria-label="루트 삭제">
            <p className="tiny muted" style={{ padding: "6px 8px 2px" }}>
              이 루트를 삭제할까요?
            </p>
            <button
              type="button"
              className="danger-text"
              onClick={() => {
                if (!account) return;
                providers.runs.deleteRoute(account.id, route.routeId);
                refresh();
                setConfirmDelete(false);
              }}
            >
              삭제
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)}>
              취소
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
