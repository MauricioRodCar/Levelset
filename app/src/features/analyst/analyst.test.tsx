import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEngineInfo } from '@/api';
import { analystReports } from '@/api/mock/researchFixtures';
import { renderApp, resetAppState } from '@/test/render';
import { server, setupMockServer } from '@/test/server';

vi.mock('./QuartersChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

setupMockServer();

beforeEach(async () => {
  await resetAppState();
});

describe('Analyst page', () => {
  it('shows TSLA quarters, TTM, translated "what changed" lines and the 8-K link', async () => {
    renderApp('/analyst?symbol=TSLA');
    const report = await screen.findByTestId('analyst-report');
    expect(within(report).getByText('Tesla, Inc.')).toBeInTheDocument();
    expect(within(report).getByTestId('earnings-badge-TSLA')).toHaveTextContent(
      'Earnings this week',
    );
    const changes = within(report).getByTestId('changes');
    expect(changes).toHaveTextContent(
      'Quarter ending Jun 30, 2026: revenue $24.87B (+10.6% vs a year earlier), net income $1.39B (+18.6%), diluted EPS $0.39 (+18.2%).',
    );
    expect(changes).toHaveTextContent('Gross margin 18.7% (+0.3 points vs the quarter before).');
    expect(changes).toHaveTextContent('Net income ($1.39B) is above operating income ($1.27B)');
    const rows = within(screen.getByTestId('quarters-table')).getAllByRole('row');
    expect(rows).toHaveLength(7); // header + 6 quarters
    expect(rows[1]).toHaveTextContent('Q2 2026');
    expect(rows[3]).toHaveTextContent('derived');
    expect(screen.getByText('$100.25B')).toBeInTheDocument(); // TTM revenue
    expect(screen.getByRole('link', { name: /Press release/ })).toHaveAttribute(
      'href',
      analystReports.TSLA.earnings8k!.pressReleaseUrl,
    );
    expect(
      screen.getByRole('img', {
        name: 'Bar chart of revenue by quarter with a line for diluted EPS',
      }),
    ).toBeInTheDocument();
  });

  it('searches a ticker and explains a ticker SEC has no numbers for', async () => {
    const user = userEvent.setup();
    renderApp('/analyst');
    expect(await screen.findByText('Look up a company')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Ticker'), 'zzzz');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('No SEC numbers for ZZZZ')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Ticker'));
    await user.type(screen.getByLabelText('Ticker'), 'not valid');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a US ticker');
  });

  it('prompts for the SEC identity and links to Settings', async () => {
    server.use(
      http.get(`${getEngineInfo().url}/analyst/:symbol`, () =>
        HttpResponse.json(
          { title: 'SEC identity missing', code: 'sec_identity_missing' },
          { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    renderApp('/analyst?symbol=TSLA');
    expect(await screen.findByText('SEC identity needed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Data & SEC' })).toHaveAttribute(
      'href',
      '/settings/data',
    );
  });

  it('speaks Spanish', async () => {
    await resetAppState({ lang: 'es' });
    renderApp('/analyst?symbol=TSLA');
    const report = await screen.findByTestId('analyst-report');
    expect(within(report).getByTestId('changes')).toHaveTextContent('Margen bruto');
    expect(within(report).getByText('Resultados esta semana')).toBeInTheDocument();
  });
});

describe('earnings badge on the dashboard', () => {
  it('marks TSLA on the watchlist and its ticket', async () => {
    renderApp('/');
    await waitFor(() =>
      expect(screen.getAllByTestId('earnings-badge-TSLA').length).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId('earnings-badge-AAPL')).not.toBeInTheDocument();
  });
});
