import { SAMPLE_CARDS } from "../../data/demo/catalog.ts";
import type { LocalStore } from "../../storage/local-store.ts";
import type { RouteCatalogProvider } from "../contracts/index.ts";

export function createMockCatalog(store: LocalStore): RouteCatalogProvider {
  const likesOf = (accountId: string) =>
    store.read<Record<string, boolean>>(`likes:${accountId}`, {});

  return {
    list(regionId) {
      return SAMPLE_CARDS.filter((c) => c.regionId === regionId);
    },
    liked(accountId, cardId) {
      return Boolean(likesOf(accountId)[cardId]);
    },
    toggleLike(accountId, cardId) {
      const likes = likesOf(accountId);
      const next = !likes[cardId];
      likes[cardId] = next;
      store.write(`likes:${accountId}`, likes);
      const card = SAMPLE_CARDS.find((c) => c.cardId === cardId);
      const displayCount = (card?.sampleLikeBase ?? 0) + (next ? 1 : 0);
      return { liked: next, displayCount };
    },
    displayCount(accountId, card) {
      return card.sampleLikeBase + (this.liked(accountId, card.cardId) ? 1 : 0);
    },
  };
}
