import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { popularToDraft, useApp } from "../../app/context.tsx";
import { AppHeader } from "../../components/chrome.tsx";
import { IconSearch } from "../../components/Icons.tsx";
import { MapThumb } from "../../components/map/MapRenderer.tsx";
import { geometryFromDirectedIds } from "../../domain/pathfinding.ts";
import { formatDistanceKm } from "../../domain/pace.ts";
import type { PlaceRef, PopularRouteCard } from "../../domain/models.ts";
import { popularCardSubtitle, refreshOwnerPopularStats, sortPopularByLikes } from "../../domain/popular.ts";

function matchesPlace(card: PopularRouteCard, place: PlaceRef): boolean {
  return card.origin.nodeId === place.nodeId || card.destination.nodeId === place.nodeId;
}

function matchesQuery(card: PopularRouteCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [card.title, card.origin.label, card.destination.label, card.sampleLabel, card.authorName].some((text) =>
    text.toLowerCase().includes(q),
  );
}

export function PopularListScreen() {
  const ctx = useApp();
  const navigate = useNavigate();
  const regionId = ctx.profile?.regionId ?? "seoul";
  const network = ctx.providers.places.getNetwork(regionId);
  const cards = ctx.providers.catalog.list(regionId);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PlaceRef | null>(null);

  const places = useMemo(
    () => (query.trim() ? ctx.providers.places.search(regionId, query) : []),
    [ctx.providers.places, query, regionId],
  );

  const visible = useMemo(() => {
    const hydrated = cards.map((card) =>
      refreshOwnerPopularStats(
        card,
        ctx.account?.id,
        card.sourceRouteId && ctx.account
          ? ctx.providers.runs.getRoute(ctx.account.id, card.sourceRouteId)
          : null,
      ),
    );
    const filtered = picked
      ? hydrated.filter((card) => matchesPlace(card, picked))
      : hydrated.filter((card) => matchesQuery(card, query));
    return sortPopularByLikes(filtered, (card) =>
      ctx.account ? ctx.providers.catalog.displayCount(ctx.account.id, card) : card.sampleLikeBase,
    );
  }, [cards, picked, query, ctx.account, ctx.providers.catalog, ctx.providers.runs]);

  return (
    <div className="app-page">
      <AppHeader title="유행하는 루트" onBack={() => navigate("/home")} centerTitle />
      <div className="page-body" style={{ paddingTop: 8 }}>
        <label className="popular-search">
          <IconSearch size={18} />
          <input
            value={query}
            placeholder="러닝하고자 하는 위치를 고르세요."
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(null);
            }}
          />
        </label>
        {places.length > 0 && !picked ? (
          <div className="popular-place-list">
            {places.slice(0, 6).map((place) => (
              <button
                key={place.placeId}
                type="button"
                className="settings-row"
                onClick={() => {
                  setPicked(place);
                  setQuery(place.label);
                }}
              >
                <span>{place.label}</span>
                <span className="tiny muted">위치</span>
              </button>
            ))}
          </div>
        ) : null}
        <p className="tiny muted" style={{ marginTop: 12 }}>
          샘플 인기 루트입니다. 실사용자 통계가 아닙니다.
        </p>
        {visible.length === 0 ? (
          <p className="tiny muted" style={{ marginTop: 16 }}>
            이 위치에 맞는 샘플 루트가 없습니다.
          </p>
        ) : (
          <div className="popular-grid">
            {visible.map((card) => (
              <button
                key={card.cardId}
                type="button"
                className="popular-card"
                onClick={() => {
                  ctx.setDraft(popularToDraft(card, ctx.draft));
                  navigate(`/popular/card/${encodeURIComponent(card.cardId)}`);
                }}
              >
                <MapThumb
                  network={network}
                  route={geometryFromDirectedIds(network, card.directedEdgeIds)}
                />
                <div className="popular-card-meta">
                  <strong>{card.title}</strong>
                  <span>{popularCardSubtitle(card)}</span>
                  <span>
                    {card.origin.label} → {card.destination.label}
                  </span>
                  <span>
                    {formatDistanceKm(card.lengthM)}
                    {" · 하트 "}
                    {ctx.account
                      ? ctx.providers.catalog.displayCount(ctx.account.id, card)
                      : card.sampleLikeBase}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
