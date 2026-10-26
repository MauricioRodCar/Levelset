import { TOKEN_KEYS, cssVar, hexToRgbChannels, type Theme } from './tokens';

/** Write a theme's tokens to CSS variables on the given element (default :root). */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  for (const key of TOKEN_KEYS) {
    const hex = theme.tokens[key];
    root.style.setProperty(cssVar(key), hex);
    root.style.setProperty(`${cssVar(key)}-rgb`, hexToRgbChannels(hex));
  }
  root.dataset.themeMode = theme.mode;
  root.dataset.themeId = theme.id;
  root.style.colorScheme = theme.mode;
}

/** Inline style object with a theme's variables, for scoped previews (e.g. preset thumbnails). */
export function themeStyleVars(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TOKEN_KEYS) {
    out[cssVar(key)] = theme.tokens[key];
    out[`${cssVar(key)}-rgb`] = hexToRgbChannels(theme.tokens[key]);
  }
  return out;
}
