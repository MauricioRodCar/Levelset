import { TOKEN_KEYS, isHexColor, type Theme } from './tokens';

/** Theme presets bundled from shared/themes/*.json (Vite alias @themes). */
const modules = import.meta.glob<Theme>('@themes/*.json', { eager: true, import: 'default' });

export const DEFAULT_THEME_ID = 'navy-teal';

export const PRESETS: readonly Theme[] = Object.values(modules)
  .filter((t) => TOKEN_KEYS.every((k) => isHexColor(t.tokens?.[k])))
  .map((t) => ({ ...t, custom: false }))
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

export function getPreset(id: string): Theme | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function defaultPreset(): Theme {
  return getPreset(DEFAULT_THEME_ID) ?? PRESETS[0];
}
