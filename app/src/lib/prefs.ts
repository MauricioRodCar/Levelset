/**
 * Small local preferences store (theme, language, onboarding, sidebar...).
 *
 * Values are cached in memory after `initPrefs()` so reads are synchronous during render.
 * Writes go to the cache immediately and to the backend asynchronously.
 * The backend is localStorage today; a Tauri store backend can be dropped in via `setPrefsBackend`
 * without touching callers.
 */
export interface PrefsBackend {
  loadAll(): Promise<Record<string, unknown>>;
  save(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

const PREFIX = 'levelset.';

export function createLocalStorageBackend(
  storage: Storage | undefined = globalThis.localStorage,
): PrefsBackend {
  return {
    async loadAll() {
      const out: Record<string, unknown> = {};
      if (!storage) return out;
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (!k || !k.startsWith(PREFIX)) continue;
        try {
          out[k.slice(PREFIX.length)] = JSON.parse(storage.getItem(k) ?? 'null');
        } catch {
          /* ignore corrupt entries */
        }
      }
      return out;
    },
    async save(key, value) {
      storage?.setItem(PREFIX + key, JSON.stringify(value));
    },
    async remove(key) {
      storage?.removeItem(PREFIX + key);
    },
  };
}

export function createMemoryBackend(initial: Record<string, unknown> = {}): PrefsBackend {
  const data = { ...initial };
  return {
    async loadAll() {
      return { ...data };
    },
    async save(key, value) {
      data[key] = value;
    },
    async remove(key) {
      delete data[key];
    },
  };
}

/** Known keys. Add new ones here so usages stay discoverable. */
export const PREF_KEYS = {
  language: 'language',
  themeId: 'theme.activeId',
  customThemes: 'theme.custom',
  onboardingDone: 'onboarding.completed',
  disclaimerAcceptedAt: 'disclaimer.acceptedAt',
  sidebarCollapsed: 'shell.sidebarCollapsed',
} as const;

let backend: PrefsBackend = createLocalStorageBackend();
let cache: Record<string, unknown> = {};

export function setPrefsBackend(b: PrefsBackend) {
  backend = b;
}

export async function initPrefs(b?: PrefsBackend) {
  if (b) backend = b;
  try {
    cache = await backend.loadAll();
  } catch {
    cache = {};
  }
}

export const prefs = {
  get<T>(key: string, fallback: T): T {
    return key in cache ? (cache[key] as T) : fallback;
  },
  set<T>(key: string, value: T) {
    cache[key] = value;
    void backend.save(key, value).catch(() => undefined);
  },
  remove(key: string) {
    delete cache[key];
    void backend.remove(key).catch(() => undefined);
  },
};
