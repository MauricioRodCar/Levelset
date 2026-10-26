import { describe, expect, it } from 'vitest';
import {
  checkContrast,
  contrastRatio,
  displayRatio,
  evaluateContrast,
  relativeLuminance,
} from './contrast';
import { PRESETS } from './presets';

describe('contrast utilities', () => {
  it('computes luminance at the extremes', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('computes the WCAG ratio (black on white = 21:1, symmetric)', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('matches known reference values', () => {
    // #767676 on white is the classic 4.54:1 AA-passing grey.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(4.5);
  });

  it('never rounds a failing ratio up to a passing display value', () => {
    expect(displayRatio(4.499)).toBe('4.4');
    expect(displayRatio(3.06)).toBe('3.0');
  });

  it('flags text below 4.5:1 and markers below 3:1', () => {
    const base = PRESETS.find((p) => p.id === 'navy-teal')!.tokens;
    const issues = checkContrast({ ...base, textMuted: '#2A3550', loss: '#3A1A1A' });
    const keys = issues.map((i) => `${i.fg}/${i.bg}`);
    expect(keys).toContain('textMuted/bg');
    expect(keys).toContain('loss/surface');
    const muted = issues.find((i) => i.fg === 'textMuted')!;
    expect(muted.required).toBe(4.5);
    const loss = issues.find((i) => i.fg === 'loss')!;
    expect(loss.required).toBe(3);
  });

  it('evaluates every rule for a theme', () => {
    const results = evaluateContrast(PRESETS[0].tokens);
    expect(results.length).toBeGreaterThan(10);
    results.forEach((r) => expect(r.ratio).toBeGreaterThanOrEqual(1));
  });
});

describe('bundled presets', () => {
  it('loads all 7 presets from shared/themes, default first', () => {
    expect(PRESETS).toHaveLength(7);
    expect(PRESETS[0].id).toBe('navy-teal');
    expect(PRESETS.some((p) => p.mode === 'light')).toBe(true);
  });

  /**
   * Known contrast failures in shared/themes (owned by the lead, reported for a fix):
   * white button text on these primaries is below 4.5:1. When a preset is fixed, delete its entry
   * here; the test fails if the list and reality diverge in either direction.
   */
  const KNOWN_PRESET_ISSUES: Record<string, string[]> = {};

  it.each(PRESETS.map((p) => [p.id, p] as const))(
    '%s passes WCAG AA contrast rules',
    (id, preset) => {
      const failing = checkContrast(preset.tokens).map((i) => `${i.fg}/${i.bg}`);
      expect(failing).toEqual(KNOWN_PRESET_ISSUES[id] ?? []);
    },
  );
});
