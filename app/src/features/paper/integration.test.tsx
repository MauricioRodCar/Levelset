/** Paper account outside its page: dashboard tile, PAPER badge, ticket line, Settings sections. */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { getEngineInfo } from '@/api/engine';
import { db, fixtures } from '@/api/mock';
import { renderApp, resetAppState } from '@/test/render';
import { server, setupMockServer } from '@/test/server';

setupMockServer();
const url = () => getEngineInfo().url;

beforeEach(async () => {
  await resetAppState();
});

describe('paper on the dashboard', () => {
  it('shows "Paper P/L today" and links to the paper page', async () => {
    renderApp('/');
    const tile = await screen.findByTestId('kpi-paper');
    expect(tile).toHaveTextContent('Paper P/L today');
    await waitFor(() => expect(tile).toHaveTextContent('-$0.88'));
    expect(tile).toHaveAttribute('href', '/paper');
    // real Day P/L stays separate
    expect(within(screen.getByTestId('kpi-row')).getByText('+$27.30')).toBeInTheDocument();
  });

  it('shows a dash and "auto-follow is off" when the engine reports null', async () => {
    server.use(
      http.get(`${url()}/dashboard`, () =>
        HttpResponse.json({ ...fixtures.dashboard, paperPnlToday: null }),
      ),
    );
    renderApp('/');
    const tile = await screen.findByTestId('kpi-paper');
    await waitFor(() => expect(tile).toHaveTextContent('auto-follow is off'));
  });

  it('lists open paper positions in Open trades with a PAPER badge, after the real ones', async () => {
    renderApp('/');
    const real = await screen.findByTestId('trade-META');
    expect(within(real).queryByTestId('paper-badge')).not.toBeInTheDocument();
    const paper = await screen.findByTestId('paper-trade-TSLA');
    expect(within(paper).getByTestId('paper-badge')).toHaveTextContent('Paper');
    expect(paper).toHaveTextContent('8 @ 364.29');
  });

  it('shows "Paper: opened 364.29" on the TSLA ticket without touching the levels', async () => {
    renderApp('/');
    const card = await screen.findByRole('article', { name: /BUY 8 TSLA/i });
    expect(within(card).getByTestId('ticket-paper')).toHaveTextContent('Paper: opened 364.29');
    // the three levels keep the ticket's numbers
    expect(card).toHaveTextContent('364.18');
    expect(card).toHaveTextContent('358.32');
    expect(card).toHaveTextContent('370.04');
  });
});

describe('Settings > Paper account', () => {
  it('turns auto-follow off and saves slippage (PATCH /paper/settings)', async () => {
    renderApp('/settings/paper');
    const sw = await screen.findByRole('switch', { name: /Follow every signal/ });
    expect(sw).toBeChecked();
    await userEvent.click(sw);
    await waitFor(() => expect(db.paper.settings.autoFollow).toBe(false));

    const pct = screen.getByLabelText('Slippage (%)');
    await userEvent.clear(pct);
    await userEvent.type(pct, '0.05');
    await userEvent.click(screen.getByRole('button', { name: 'Save slippage' }));
    await waitFor(() => expect(db.paper.settings.slippagePct).toBe(0.05));
    expect(db.paper.settings.slippagePerShare).toBe(0.01);
  });

  it('rejects out-of-range slippage before sending', async () => {
    renderApp('/settings/paper');
    const per = await screen.findByLabelText('Spread ($ per share, each side)');
    await userEvent.clear(per);
    await userEvent.type(per, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save slippage' }));
    expect(await screen.findByText('Enter an amount from 0 to 1.')).toBeInTheDocument();
    expect(db.paper.settings.slippagePerShare).toBe(0.01);
  });
});

describe('Settings > System', () => {
  it('is disabled with a note in the web / mock build', async () => {
    renderApp('/settings/system');
    expect(await screen.findByTestId('system-web-note')).toHaveTextContent(
      'not available in the web demo',
    );
    expect(screen.getByRole('switch', { name: /Start with Windows/ })).toBeDisabled();
    expect(screen.getByRole('switch', { name: /Keep the PC awake/ })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByTestId('system-demo-state')).toHaveTextContent('Demo mode is on'),
    );
    expect(screen.getByRole('button', { name: 'Turn off demo mode…' })).toBeDisabled();
  });
});
