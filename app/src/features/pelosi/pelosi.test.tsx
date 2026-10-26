import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/api/mock';
import { toast } from '@/components/ui/toaster';
import { renderApp, resetAppState } from '@/test/render';
import { setupMockServer } from '@/test/server';

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => 'denied'),
  sendNotification: vi.fn(),
}));

setupMockServer();

beforeEach(async () => {
  await resetAppState();
  toast.dismiss();
});

describe('Congress trades page', () => {
  it('lists PTR rows with the delay note, the Pelosi options trade and unread filings', async () => {
    renderApp('/pelosi');
    const table = await screen.findByTestId('congress-table');
    expect(screen.getByTestId('congress-note')).toHaveTextContent(
      'Public disclosures, delayed up to 45 days after the trade. Amounts are ranges. Not inside information.',
    );
    const call = within(table).getByTestId('ptr-20035143-2');
    expect(call).toHaveTextContent('Hon. Nancy Pelosi');
    expect(call).toHaveTextContent('Spouse');
    expect(call).toHaveTextContent('BE');
    expect(call).toHaveTextContent('100 call options, strike $100.00, expire Jun 17, 2027');
    expect(call).toHaveTextContent('$1,000,001 - $5,000,000');
    expect(call).toHaveTextContent('28 days');
    expect(screen.getByTestId('unread-filings')).toHaveTextContent('Hon. Nancy Pelosi');
  });

  it('filters by member and type, and flags watchlist / position tickers', async () => {
    const user = userEvent.setup();
    db.trades = [{ ...db.trades[0], symbol: 'AMAT' }];
    renderApp('/pelosi');
    await screen.findByTestId('congress-table');
    await user.click(screen.getByLabelText('Only my watchlist and positions'));
    await waitFor(() =>
      expect(screen.getByTestId('congress-table')).toHaveTextContent('You hold it'),
    );
    const rows = within(screen.getByTestId('congress-table')).getAllByRole('row').slice(1);
    expect(rows.every((r) => /AMAT/.test(r.textContent ?? ''))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.type(screen.getByLabelText('Member'), 'salazar');
    await user.selectOptions(screen.getByLabelText('Type'), 'sell');
    await waitFor(() => {
      const r = within(screen.getByTestId('congress-table')).getAllByRole('row').slice(1);
      expect(r.length).toBeGreaterThan(0);
      expect(r.every((x) => /Salazar/.test(x.textContent ?? ''))).toBe(true);
    });
    expect(screen.getByTestId('congress-table')).toHaveTextContent('Partial sale');
  });

  it('refresh finds the held-back filing and notifies once about the watchlist', async () => {
    const user = userEvent.setup();
    renderApp('/pelosi');
    await screen.findByTestId('congress-table');
    expect(screen.queryByTestId('ptr-20033725-1')).not.toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await user.click(screen.getByRole('button', { name: 'Check for new filings' }));
    expect(await screen.findByText('New Congress filing: Hon. Nancy Pelosi')).toBeInTheDocument();
    expect(screen.getByText(/Mentions NVDA/)).toBeInTheDocument();
    expect(await screen.findByTestId('ptr-20033725-1')).toBeInTheDocument();
    expect(await screen.findByText('1 new filing')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check for new filings' }));
    expect(await screen.findByText('No new filings since the last check.')).toBeInTheDocument();
    expect(screen.getAllByText('New Congress filing: Hon. Nancy Pelosi')).toHaveLength(1);
  });

  it('the notify toggle saves CongressSettings', async () => {
    const user = userEvent.setup();
    renderApp('/pelosi');
    const sw = await screen.findByRole('switch', {
      name: 'Notify me when a new filing mentions my watchlist',
    });
    await waitFor(() => expect(sw).toBeEnabled());
    expect(sw).toBeChecked();
    await user.click(sw);
    await waitFor(() => expect(db.research.settings.notifyOnWatchlist).toBe(false));
    expect(sw).not.toBeChecked();
  });

  it('speaks Spanish', async () => {
    await resetAppState({ lang: 'es' });
    renderApp('/pelosi');
    await screen.findByTestId('congress-table');
    expect(screen.getByTestId('congress-note')).toHaveTextContent('No es información privilegiada');
    expect(screen.getAllByText('Cónyuge').length).toBeGreaterThan(0);
  });
});
