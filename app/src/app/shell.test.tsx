import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { getEngineInfo } from '@/api/engine';
import { renderApp, resetAppState } from '@/test/render';
import { server, setupMockServer } from '@/test/server';
import { useThemeStore } from '@/theme';

setupMockServer();

beforeEach(async () => {
  await resetAppState();
});

describe('app shell', () => {
  it('tells the engine onboarding is done once the engine answers', async () => {
    let reports = 0;
    server.use(
      http.post(`${getEngineInfo().url}/system/onboarding`, () => {
        reports += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp('/');
    await waitFor(() => expect(reports).toBe(1));
  });

  it('renders sidebar, status bar from /status and the dashboard placeholder', async () => {
    renderApp('/');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    for (const label of [
      'Dashboard',
      'Pipeline',
      'Alerts',
      'Analyst',
      'Pelosi',
      'Connections',
      'Settings',
    ]) {
      expect(within(nav).getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(within(nav).queryByText('v1.1')).not.toBeInTheDocument();
    expect(await screen.findByText('Market open')).toBeInTheDocument();
    expect(screen.getByText('closes 16:00 ET')).toBeInTheDocument();
    expect(screen.getByText('Data delayed 15 min')).toBeInTheDocument();
    expect(screen.getByTestId('ny-clock').textContent).toMatch(/10:1\d:\d\d ET/);
    // sidebar footer mode label (PAPER badges elsewhere on the dashboard say "Paper" too)
    expect(
      within(screen.getByText('Free tier').parentElement!).getByText('Paper'),
    ).toBeInTheDocument();
    expect(screen.getByText('Free tier')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Not financial advice.')).toBeInTheDocument();
  });

  it('switches the whole UI to Spanish and persists it', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByText('Market open');
    await user.click(screen.getByRole('radio', { name: 'ES' }));
    expect(await screen.findByText('Mercado abierto')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Panel' })).toBeInTheDocument();
    expect(screen.getByText('No es asesoría financiera.')).toBeInTheDocument();
  });

  it('shows engine offline with retry when /status fails', async () => {
    server.use(http.get(`${getEngineInfo().url}/status`, () => HttpResponse.error()));
    renderApp('/');
    expect(await screen.findByText('Engine offline')).toBeInTheDocument();
    expect(screen.getByText("Can't reach the Levelset engine")).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Retry/ }).length).toBeGreaterThan(0);
  });

  it('collapses the sidebar', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('serves the v1.1 Analyst and Congress trades pages', async () => {
    renderApp('/analyst');
    expect(await screen.findByText('Look up a company')).toBeInTheDocument();
  });

  it('redirects to onboarding on first run', async () => {
    await resetAppState({ onboardingDone: false });
    renderApp('/');
    expect(await screen.findByText('Welcome to Levelset')).toBeInTheDocument();
  });
});

describe('onboarding', () => {
  it('walks language -> theme -> limits -> disclaimer -> dashboard', async () => {
    await resetAppState({ onboardingDone: false });
    const user = userEvent.setup();
    const { router } = renderApp('/onboarding');
    await user.click(screen.getByRole('radio', { name: /Spanish/ }));
    expect(await screen.findByText('Te damos la bienvenida a Levelset')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Inglés/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    expect(screen.getByText('Pick a look')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Daylight/ }));
    expect(useThemeStore.getState().activeId).toBe('daylight');
    await user.click(screen.getByRole('button', { name: /Next/ }));

    expect(screen.getByText('Your account and limits')).toBeInTheDocument();
    const size = await screen.findByLabelText('Account size (USD)');
    await waitFor(() => expect(size).toHaveValue(10000));
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(await screen.findByText('Before you start')).toBeInTheDocument();
    const cont = screen.getByRole('button', { name: /Accept and continue/ });
    expect(cont).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(cont);

    await user.click(screen.getByRole('button', { name: /Go to dashboard/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });
});
