import { TOKEN_KEYS, isHexColor, type Theme, type ThemeTokens } from './tokens';

export type ThemeImportError = 'invalid_json' | 'missing_tokens' | 'invalid_color';

export type ThemeImportResult =
  { ok: true; theme: Theme } | { ok: false; error: ThemeImportError; detail?: string };

/** Export a theme as pretty JSON in the same shape as shared/themes/*.json. */
export function exportThemeJson(theme: Theme): string {
  const { id, name, mode, tokens } = theme;
  return JSON.stringify({ id, name, mode, tokens }, null, 2);
}

/** Parse and validate a theme JSON string. The caller assigns a fresh id before saving. */
export function parseThemeJson(text: string): ThemeImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('tokens' in raw) ||
    !raw.tokens ||
    typeof raw.tokens !== 'object'
  ) {
    return { ok: false, error: 'missing_tokens' };
  }
  const obj = raw as {
    id?: unknown;
    name?: unknown;
    mode?: unknown;
    tokens: Record<string, unknown>;
  };
  const tokens = {} as ThemeTokens;
  for (const k of TOKEN_KEYS) {
    const v = obj.tokens[k];
    if (v === undefined) return { ok: false, error: 'missing_tokens', detail: k };
    if (!isHexColor(v)) return { ok: false, error: 'invalid_color', detail: k };
    tokens[k] = v.toUpperCase();
  }
  let name = 'Imported theme';
  if (typeof obj.name === 'string' && obj.name.trim()) name = obj.name.trim();
  else if (obj.name && typeof obj.name === 'object' && 'en' in obj.name) name = String(obj.name.en);
  return {
    ok: true,
    theme: {
      id: typeof obj.id === 'string' ? obj.id : 'imported',
      name,
      mode: obj.mode === 'light' ? 'light' : 'dark',
      tokens,
      custom: true,
    },
  };
}

export function newThemeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
