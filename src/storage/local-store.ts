import { STORAGE_PREFIX, STORAGE_SCHEMA_VERSION } from "../config/app.ts";

export type StorageAdapter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
};

export class MemoryStorage implements StorageAdapter {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  keys() {
    return [...this.data.keys()];
  }
}

export class BrowserStorage implements StorageAdapter {
  getItem(key: string) {
    return localStorage.getItem(key);
  }
  setItem(key: string, value: string) {
    localStorage.setItem(key, value);
  }
  removeItem(key: string) {
    localStorage.removeItem(key);
  }
  keys() {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key) out.push(key);
    }
    return out;
  }
}

export class LocalStore {
  readonly adapter: StorageAdapter;
  error: string | null = null;

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
    this.ensureSchema();
  }

  key(name: string): string {
    return `${STORAGE_PREFIX}${name}`;
  }

  read<T>(name: string, fallback: T): T {
    const raw = this.adapter.getItem(this.key(name));
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      this.error = "저장된 데이터를 읽지 못했습니다.";
      return fallback;
    }
  }

  write<T>(name: string, value: T): boolean {
    try {
      this.adapter.setItem(this.key(name), JSON.stringify(value));
      this.error = null;
      return true;
    } catch {
      this.error = "저장 공간이 부족하거나 기록할 수 없습니다.";
      return false;
    }
  }

  remove(name: string): void {
    this.adapter.removeItem(this.key(name));
  }

  resetAppData(): void {
    for (const key of this.adapter.keys()) {
      if (key.startsWith(STORAGE_PREFIX)) this.adapter.removeItem(key);
    }
    this.error = null;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    const version = this.read<number>("schemaVersion", 0);
    if (version === 0) {
      this.write("schemaVersion", STORAGE_SCHEMA_VERSION);
      return;
    }
    if (version < STORAGE_SCHEMA_VERSION) {
      this.migrate(version);
    }
  }

  private migrate(from: number): void {
    if (from < 1) {
      this.write("schemaVersion", STORAGE_SCHEMA_VERSION);
    }
  }
}

export function createBrowserStore(): LocalStore {
  if (typeof localStorage === "undefined") return new LocalStore(new MemoryStorage());
  return new LocalStore(new BrowserStorage());
}
