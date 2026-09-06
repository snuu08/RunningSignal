import { defaultAppSettings, normalizeAppSettings } from "../../domain/settings.ts";
import type { UserAppSettings } from "../../domain/models.ts";
import type { LocalStore } from "../../storage/local-store.ts";
import type { SettingsStore } from "../contracts/index.ts";

export function createSettingsStore(store: LocalStore): SettingsStore {
  return {
    get(accountId) {
      const raw = store.read<Partial<UserAppSettings> | null>(`settings:${accountId}`, null);
      return normalizeAppSettings(raw);
    },
    save(accountId, patch) {
      const next = normalizeAppSettings({ ...this.get(accountId), ...patch });
      const ok = store.write(`settings:${accountId}`, next);
      return ok ? next : null;
    },
  };
}

export { defaultAppSettings };
