import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { routes } from '@/app/routes';
import { Providers } from '@/app/Providers';
import { useUiStore } from '@/app/uiStore';
import { initI18n } from '@/i18n';
import { createMemoryBackend, initPrefs } from '@/lib/prefs';
import { useThemeStore } from '@/theme';

/** Fresh prefs, English, default theme, onboarding state. Call in beforeEach. */
export async function resetAppState({ onboardingDone = true, lang = 'en' as 'en' | 'es' } = {}) {
  await initPrefs(createMemoryBackend({ 'onboarding.completed': onboardingDone }));
  useThemeStore.setState({ activeId: 'navy-teal', custom: [] });
  useUiStore.getState().hydrate();
  await initI18n(lang);
}

export function testQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

/** Render the full app (routes + providers) at a path. */
export function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <Providers client={testQueryClient()}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...utils, router };
}

/** Render a single component inside the app providers. */
export function renderWithProviders(ui: ReactElement) {
  return render(<Providers client={testQueryClient()}>{ui}</Providers>);
}
