import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/api/mock';
import { renderApp, resetAppState } from '@/test/render';
import { setupMockServer } from '@/test/server';

// jsdom has no canvas: the equity chart is replaced by a stub that records its props.
vi.mock('./EquityChart', () => ({
  default: (p: { ariaLabel: string; points: unknown[] }) => (
    <div role="img" aria-label={p.ariaLabel} data-points={p.points.length} />
  ),
}));

setupMockServer();

beforeEach(async () => {
  await resetAppState();
});

describe('paper account page', () => {
  it('shows the account, stats, equity curve, breakdown and the PRD constraint notes', async () => {
    renderApp('/paper');
    expect(await screen.findByRole('heading', { name: 'Paper account' })).toBeInTheDocument();
    const summary = await screen.findByTestId('paper-account-summary');
    expect(summary).toHaveTextContent('1 open position');
    const stats = await screen.findByTestId('paper-stats');
    for (const label of [
      'Total P/L',
      'Win rate',
      'Expectancy',
      'Profit factor',
      'Max drawdown',
      'Longest losing streak',
    ])
      expect(within(stats).getByText(label)).toBeInTheDocument();
    const chart = await screen.findByRole('img', { name: /Paper equity curve/ });
    expect(Number(chart.getAttribute('data-points'))).toBeGreaterThan(5);
    expect(await screen.findByTestId('paper-breakdown')).toHaveTextContent('TSLA');
    await userEvent.click(screen.getByRole('radio', { name: 'Weekday' }));
    expect(await screen.findByText('Monday')).toBeInTheDocument();
    const notes = screen.getByTestId('paper-notes');
    expect(notes).toHaveTextContent('delayed and bar-based');
    expect(notes).toHaveTextContent('on, awake and online during market hours');
    // the open TSLA paper position, filled at the next bar open plus slippage
    const positions = await screen.findByTestId('paper-positions');
    expect(positions).toHaveTextContent('8 filled at 364.29');
    expect(within(positions).getByTestId('paper-badge')).toBeInTheDocument();
  });

  it('lists closed and skipped trades with reasons, backfilled markers and View flow links', async () => {
    renderApp('/paper');
    const log = await screen.findByTestId('paper-trade-log');
    const nvda = within(log).getByTestId('paper-trade-ptr_20261016_nvda');
    expect(nvda).toHaveTextContent('182.00');
    expect(nvda).toHaveTextContent('186.05');
    expect(nvda).toHaveTextContent('Take profit');
    expect(
      within(nvda).getByRole('link', { name: 'View the pipeline run for NVDA' }),
    ).toHaveAttribute('href', '/pipeline/run_20261016_1005_nvda');
    const amd = within(log).getByTestId('paper-trade-pskp_20261019_amd');
    expect(amd).toHaveTextContent('Skipped: blocked by the risk check');
    expect(within(log).getAllByTestId('backfilled').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('radio', { name: 'Skipped' }));
    await waitFor(() =>
      expect(
        screen.getByTestId('paper-trade-log').querySelectorAll('tr[data-kind="closed"]'),
      ).toHaveLength(0),
    );
  });

  it('compares signals with the recorded fills', async () => {
    renderApp('/paper');
    const cmp = await screen.findByTestId('paper-compare');
    expect(cmp).toHaveTextContent('Signals (paper)');
    expect(cmp).toHaveTextContent('You (recorded fills)');
    expect(cmp).toHaveTextContent(/only in your fills/);
  });

  it('resets the account only after confirming, and starts a new period', async () => {
    renderApp('/paper');
    await screen.findByTestId('paper-account-summary');
    await userEvent.click(screen.getByRole('button', { name: 'Reset…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset Paper 1?' });
    expect(db.paper.positions).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(db.paper.positions).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Reset…' }));
    const again = await screen.findByRole('dialog', { name: 'Reset Paper 1?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Reset account' }));
    await waitFor(() => expect(db.paper.positions).toHaveLength(0));
    expect(await screen.findByText(/Paper 1 was reset\. Period 3 started\./)).toBeInTheDocument();
    expect(await screen.findByText('No open paper positions.')).toBeInTheDocument();
  });

  it('creates and switches to a new account', async () => {
    renderApp('/paper');
    await screen.findByTestId('paper-account-summary');
    await userEvent.click(screen.getByRole('button', { name: 'New account' }));
    const dialog = await screen.findByRole('dialog', { name: 'New paper account' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Swing test');
    await userEvent.type(within(dialog).getByLabelText('Starting balance (USD)'), '2500');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('option', { name: 'Swing test (active)' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('paper-account-summary')).toHaveTextContent('$2,500.00'),
    );
    expect(await screen.findByText('No paper trades in this range.')).toBeInTheDocument();
  });

  it('exports the trade log as CSV (browser download outside the desktop app)', async () => {
    const created: Blob[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (b: Blob) => {
      created.push(b);
      return 'blob:paper';
    };
    URL.revokeObjectURL = () => undefined;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    try {
      renderApp('/paper');
      await screen.findByTestId('paper-account-summary');
      await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
      expect(await screen.findByText('Saved levelset-paper-pacc_1.csv')).toBeInTheDocument();
      expect(click).toHaveBeenCalled();
      const text = await created[0].text();
      expect(text.split('\n')[0]).toMatch(/^id,accountId,periodId,kind,symbol/);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      click.mockRestore();
    }
  });

  it('has a sidebar entry', async () => {
    renderApp('/');
    await userEvent.click(await screen.findByRole('link', { name: /Paper account/ }));
    expect(await screen.findByRole('heading', { name: 'Paper account' })).toBeInTheDocument();
  });

  it('renders in Spanish', async () => {
    await resetAppState({ lang: 'es' });
    renderApp('/paper');
    expect(await screen.findByRole('heading', { name: 'Cuenta de práctica' })).toBeInTheDocument();
    expect(await screen.findByText('Señales vs. tú')).toBeInTheDocument();
    expect(await screen.findByTestId('paper-positions')).toHaveTextContent('8 compradas a 364.29');
  });
});
