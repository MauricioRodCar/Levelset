import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend, initPrefs, prefs, PREF_KEYS } from '@/lib/prefs';
import { exportThemeJson, parseThemeJson } from './io';
import { getPreset } from './presets';
import { findTheme, useThemeStore } from './store';

beforeEach(async () => {
  await initPrefs(createMemoryBackend());
  useThemeStore.setState({ activeId: 'navy-teal', custom: [] });
});

describe('theme store', () => {
  it('creates a custom theme from a preset, edits, renames, resets and deletes it', () => {
    const s = useThemeStore.getState();
    const id = s.createFrom('daylight', 'My light');
    let t = findTheme(id, useThemeStore.getState().custom)!;
    expect(t.custom).toBe(true);
    expect(t.basedOn).toBe('daylight');
    expect(t.mode).toBe('light');
    expect(useThemeStore.getState().activeId).toBe(id);

    useThemeStore.getState().setToken(id, 'primary', '#123abc');
    t = findTheme(id, useThemeStore.getState().custom)!;
    expect(t.tokens.primary).toBe('#123ABC');

    useThemeStore.getState().rename(id, '  Renamed  ');
    expect(findTheme(id, useThemeStore.getState().custom)!.name).toBe('Renamed');

    useThemeStore.getState().reset(id);
    expect(findTheme(id, useThemeStore.getState().custom)!.tokens.primary).toBe(
      getPreset('daylight')!.tokens.primary,
    );

    useThemeStore.getState().remove(id);
    expect(useThemeStore.getState().custom).toHaveLength(0);
    expect(useThemeStore.getState().activeId).toBe('daylight');
  });

  it('persists active theme and custom themes through prefs', () => {
    const id = useThemeStore.getState().createFrom('navy-teal', 'Saved');
    expect(prefs.get(PREF_KEYS.themeId, '')).toBe(id);
    useThemeStore.setState({ activeId: 'navy-teal', custom: [] });
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().activeId).toBe(id);
    expect(useThemeStore.getState().custom).toHaveLength(1);
  });

  it('round-trips export/import and rejects invalid JSON', () => {
    const json = exportThemeJson(getPreset('high-contrast')!);
    const res = useThemeStore.getState().importJson(json);
    expect(res.ok).toBe(true);
    expect(useThemeStore.getState().custom).toHaveLength(1);

    expect(parseThemeJson('{nope').ok).toBe(false);
    const bad = parseThemeJson(JSON.stringify({ tokens: { bg: 'red' } }));
    expect(bad).toMatchObject({ ok: false });
  });

  it('ignores unknown theme ids', () => {
    useThemeStore.getState().setActive('does-not-exist');
    expect(useThemeStore.getState().activeId).toBe('navy-teal');
  });
});
