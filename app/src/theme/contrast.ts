import type { ThemeTokens, TokenKey } from './tokens';

/** WCAG 2.x relative luminance of a #RRGGBB colour. */
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const TEXT_MIN = 4.5;
export const MARKER_MIN = 3;

export type ContrastKind = 'text' | 'marker';

export interface ContrastRule {
  fg: TokenKey;
  bg: TokenKey;
  kind: ContrastKind;
}

/**
 * Pairs checked for every theme.
 * - text (4.5:1, WCAG AA): body text, muted labels, links, text on primary buttons.
 * - marker (3:1, WCAG non-text contrast): profit/loss/warning/info/primary on small markers, icons
 *   and badges. Badges always carry an icon + label, so colour is never the only signal.
 */
export const CONTRAST_RULES: readonly ContrastRule[] = [
  { fg: 'text', bg: 'bg', kind: 'text' },
  { fg: 'text', bg: 'surface', kind: 'text' },
  { fg: 'text', bg: 'surface2', kind: 'text' },
  { fg: 'textMuted', bg: 'bg', kind: 'text' },
  { fg: 'textMuted', bg: 'surface', kind: 'text' },
  { fg: 'onPrimary', bg: 'primary', kind: 'text' },
  { fg: 'accent', bg: 'bg', kind: 'text' },
  { fg: 'accent', bg: 'surface', kind: 'text' },
  { fg: 'profit', bg: 'bg', kind: 'marker' },
  { fg: 'profit', bg: 'surface', kind: 'marker' },
  { fg: 'loss', bg: 'bg', kind: 'marker' },
  { fg: 'loss', bg: 'surface', kind: 'marker' },
  { fg: 'warning', bg: 'surface', kind: 'marker' },
  { fg: 'info', bg: 'surface', kind: 'marker' },
  { fg: 'primary', bg: 'surface', kind: 'marker' },
];

export interface ContrastResult extends ContrastRule {
  ratio: number;
  required: number;
}

export function requiredRatio(kind: ContrastKind): number {
  return kind === 'text' ? TEXT_MIN : MARKER_MIN;
}

/** All rule results (passing and failing). */
export function evaluateContrast(tokens: ThemeTokens): ContrastResult[] {
  return CONTRAST_RULES.map((r) => ({
    ...r,
    ratio: contrastRatio(tokens[r.fg], tokens[r.bg]),
    required: requiredRatio(r.kind),
  }));
}

/** Only failing pairs; an empty array means the theme passes. */
export function checkContrast(tokens: ThemeTokens): ContrastResult[] {
  return evaluateContrast(tokens).filter((r) => r.ratio < r.required);
}

/** Round down to one decimal so 4.49 never displays as a passing "4.5". */
export function displayRatio(ratio: number): string {
  return (Math.floor(ratio * 10) / 10).toFixed(1);
}
