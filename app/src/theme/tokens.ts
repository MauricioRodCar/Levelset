/**
 * Semantic theme tokens. A theme JSON (shared/themes/*.json) uses the camelCase keys;
 * at runtime each token becomes two CSS variables on :root:
 *   --ls-<css-name>       "#RRGGBB"  (use in CSS / inline styles: var(--ls-loss))
 *   --ls-<css-name>-rgb   "r g b"    (used by Tailwind so `bg-primary/10` works)
 * Tailwind colour names: bg, surface, surface2, border, text, text-muted, primary, on-primary,
 * accent, profit, loss, warning, info (e.g. `bg-surface2`, `text-text-muted`).
 */
export const TOKEN_KEYS = [
  'bg',
  'surface',
  'surface2',
  'border',
  'text',
  'textMuted',
  'primary',
  'onPrimary',
  'accent',
  'profit',
  'loss',
  'warning',
  'info',
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];
export type ThemeTokens = Record<TokenKey, string>;

/** CSS variable stem per token (without the --ls- prefix). */
export const TOKEN_CSS_NAME: Record<TokenKey, string> = {
  bg: 'bg',
  surface: 'surface',
  surface2: 'surface-2',
  border: 'border',
  text: 'text',
  textMuted: 'text-muted',
  primary: 'primary',
  onPrimary: 'on-primary',
  accent: 'accent',
  profit: 'profit',
  loss: 'loss',
  warning: 'warning',
  info: 'info',
};

export function cssVar(key: TokenKey): string {
  return `--ls-${TOKEN_CSS_NAME[key]}`;
}

/** `var(--ls-<token>)` for inline styles, e.g. style={{ background: tokenVar('loss') }}. */
export function tokenVar(key: TokenKey): string {
  return `var(${cssVar(key)})`;
}

export type LocalizedName =
  string | { en: string; es?: string; [lang: string]: string | undefined };

export interface Theme {
  id: string;
  name: LocalizedName;
  mode: 'dark' | 'light';
  order?: number;
  tokens: ThemeTokens;
  /** true for user-created themes (editable, deletable). */
  custom?: boolean;
  /** preset id a custom theme was created from (used by Reset). */
  basedOn?: string;
}

export function themeName(theme: Pick<Theme, 'name'>, lang: string): string {
  if (typeof theme.name === 'string') return theme.name;
  return theme.name[lang.slice(0, 2)] ?? theme.name.en;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v);
}

export function hexToRgbChannels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
