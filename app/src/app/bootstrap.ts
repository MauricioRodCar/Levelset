import { resolveEngineInfo } from '@/api/engine';
import { initI18n } from '@/i18n';
import { env } from '@/lib/env';
import { initPrefs } from '@/lib/prefs';
import { applyTheme, defaultPreset, findTheme, useThemeStore } from '@/theme';
import { useUiStore } from './uiStore';

/**
 * Everything that must happen before the first render:
 * prefs -> theme (no flash) -> i18n -> engine URL/token -> mock engine (VITE_MOCK=1).
 */
export async function bootstrap() {
  await initPrefs();
  useThemeStore.getState().hydrate();
  useUiStore.getState().hydrate();
  const { activeId, custom } = useThemeStore.getState();
  applyTheme(findTheme(activeId, custom) ?? defaultPreset());

  await initI18n();
  await resolveEngineInfo();

  if (env.mock) {
    const { startMockEngine } = await import('@/api/mock/browser');
    await startMockEngine();
  }
}
