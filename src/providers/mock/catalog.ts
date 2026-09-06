import { SAMPLE_CARDS } from "../../data/demo/catalog.ts";
import type { PopularRouteCard } from "../../domain/models.ts";
import type { LocalStore } from "../../storage/local-store.ts";
import type { RouteCatalogProvider } from "../contracts/index.ts";

const UPLOADS_KEY = "popular:uploads";

function normalizeUploaded(raw: PopularRouteCard): PopularRouteCard {
  return {
    ...raw,
    authorName: raw.authorName ?? "러너",
    authorAccountId: raw.authorAccountId ?? null,
    sourceRouteId: raw.sourceRouteId ?? null,
    averagePaceSeconds: raw.averagePaceSeconds ?? null,
    elapsedSeconds: raw.elapsedSeconds ?? null,
  };
}

export function createMockCatalog(store: LocalStore): RouteCatalogProvider {
  const likesOf = (accountId: string) =>
    store.read<Record<string, boolean>>(`likes:${accountId}`, {});

  const uploads = () => store.read<PopularRouteCard[]>(UPLOADS_KEY, []).map(normalizeUploaded);

  const allCards = () => [...SAMPLE_CARDS, ...uploads()];

  return {
    list(regionId) {
      return allCards().filter((c) => c.regionId === regionId);
    },
    get(cardId) {
      return allCards().find((c) => c.cardId === cardId) ?? null;
    },
    liked(accountId, cardId) {
      return Boolean(likesOf(accountId)[cardId]);
    },
    toggleLike(accountId, cardId) {
      const likes = likesOf(accountId);
      const next = !likes[cardId];
      likes[cardId] = next;
      store.write(`likes:${accountId}`, likes);
      const card = allCards().find((c) => c.cardId === cardId);
      const displayCount = (card?.sampleLikeBase ?? 0) + (next ? 1 : 0);
      return { liked: next, displayCount };
    },
    displayCount(accountId, card) {
      return card.sampleLikeBase + (this.liked(accountId, card.cardId) ? 1 : 0);
    },
    publish(card) {
      const existing = uploads();
      const idx = existing.findIndex(
        (item) => item.cardId === card.cardId || item.sourceRouteId === card.sourceRouteId,
      );
      if (idx >= 0) {
        existing[idx] = { ...existing[idx], ...card, cardId: existing[idx].cardId };
        store.write(UPLOADS_KEY, existing);
        return existing[idx];
      }
      existing.unshift(card);
      store.write(UPLOADS_KEY, existing);
      return card;
    },
    renameCard(accountId, cardId, title) {
      const next = title.trim();
      if (!next) return null;
      const existing = uploads();
      const idx = existing.findIndex((item) => item.cardId === cardId);
      if (idx < 0) return null;
      if (existing[idx].authorAccountId !== accountId) return null;
      existing[idx] = { ...existing[idx], title: next };
      store.write(UPLOADS_KEY, existing);
      return existing[idx];
    },
    findBySourceRoute(routeId) {
      return uploads().find((item) => item.sourceRouteId === routeId) ?? null;
    },
  };
}
