import { create } from 'zustand';
import { PREF_KEYS, prefs } from '@/lib/prefs';
import { newThemeId, parseThemeJson, type ThemeImportResult } from './io';
import { DEFAULT_THEME_ID, PRESETS, defaultPreset, getPreset } from './presets';
import type { Theme, TokenKey } from './tokens';

interface ThemeState {
  activeId: string;
  custom: Theme[];
  /** Re-read persisted prefs (called once after initPrefs). */
  hydrate: () => void;
  setActive: (id: string) => void;
  /** Copy any theme (preset or custom) into a new custom theme and activate it. Returns its id. */
  createFrom: (sourceId: string, name: string) => string;
  /** Change one token of a custom theme. */
  setToken: (id: string, key: TokenKey, hex: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  /** Reset a custom theme's tokens to the preset it was created from. */
  reset: (id: string) => void;
  importJson: (text: string) => ThemeImportResult;
}

function persist(state: Pick<ThemeState, 'activeId' | 'custom'>) {
  prefs.set(PREF_KEYS.themeId, state.activeId);
  prefs.set(PREF_KEYS.customThemes, state.custom);
}

export function findTheme(id: string, custom: Theme[]): Theme | undefined {
  return custom.find((t) => t.id === id) ?? getPreset(id);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  activeId: DEFAULT_THEME_ID,
  custom: [],

  hydrate: () => {
    const custom = prefs.get<Theme[]>(PREF_KEYS.customThemes, []).filter((t) => t && t.tokens);
    const activeId = prefs.get<string>(PREF_KEYS.themeId, DEFAULT_THEME_ID);
    set({ custom, activeId: findTheme(activeId, custom) ? activeId : DEFAULT_THEME_ID });
  },

  setActive: (id) => {
    if (!findTheme(id, get().custom)) return;
    set({ activeId: id });
    persist(get());
  },

  createFrom: (sourceId, name) => {
    const src = findTheme(sourceId, get().custom) ?? defaultPreset();
    const theme: Theme = {
      id: newThemeId(),
      name,
      mode: src.mode,
      tokens: { ...src.tokens },
      custom: true,
      basedOn: src.custom ? src.basedOn : src.id,
    };
    set({ custom: [...get().custom, theme], activeId: theme.id });
    persist(get());
    return theme.id;
  },

  setToken: (id, key, hex) => {
    set({
      custom: get().custom.map((t) =>
        t.id === id ? { ...t, tokens: { ...t.tokens, [key]: hex.toUpperCase() } } : t,
      ),
    });
    persist(get());
  },

  rename: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set({ custom: get().custom.map((t) => (t.id === id ? { ...t, name: trimmed } : t)) });
    persist(get());
  },

  remove: (id) => {
    const custom = get().custom.filter((t) => t.id !== id);
    const removed = get().custom.find((t) => t.id === id);
    const activeId =
      get().activeId === id ? (removed?.basedOn ?? DEFAULT_THEME_ID) : get().activeId;
    set({ custom, activeId: findTheme(activeId, custom) ? activeId : DEFAULT_THEME_ID });
    persist(get());
  },

  reset: (id) => {
    const t = get().custom.find((c) => c.id === id);
    const base = (t?.basedOn && getPreset(t.basedOn)) || defaultPreset();
    set({
      custom: get().custom.map((c) =>
        c.id === id ? { ...c, mode: base.mode, tokens: { ...base.tokens } } : c,
      ),
    });
    persist(get());
  },

  importJson: (text) => {
    const res = parseThemeJson(text);
    if (!res.ok) return res;
    const theme: Theme = { ...res.theme, id: newThemeId(), custom: true };
    set({ custom: [...get().custom, theme], activeId: theme.id });
    persist(get());
    return { ok: true, theme };
  },
}));

export function useActiveTheme(): Theme {
  return useThemeStore((s) => findTheme(s.activeId, s.custom) ?? defaultPreset());
}

export function useAllThemes(): { presets: readonly Theme[]; custom: Theme[] } {
  const custom = useThemeStore((s) => s.custom);
  return { presets: PRESETS, custom };
}
