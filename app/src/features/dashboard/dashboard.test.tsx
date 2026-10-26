import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { getEngineInfo } from '@/api/engine';
import { fixtures } from '@/api/mock';
import { renderApp, resetAppState } from '@/test/render';
import { server, setupMockServer } from '@/test/server';
import { bestHit, sortTickets } from './scan';

setupMockServer();
const url = () => getEngineInfo().url;

beforeEach(async () => {
  await resetAppState();
});

describe('dashboard', () => {
  it('renders KPIs, tickets, watchlist, open trades and news from the engine', async () => {
    renderApp('/');
    const kpis = await screen.findByTestId('kpi-row');
    expect(await within(kpis).findByText('+$27.30')).toBeInTheDocument();
    expect(within(kpis).getByText('$48.00')).toBeInTheDocument();
    expect(within(kpis).getByText('of $95.00 daily limit')).toBeInTheDocument();
    expect(within(kpis).getByText('of 3 max')).toBeInTheDocument();

    expect(await screen.findByRole('article', { name: 'Ticket BUY 8 TSLA' })).toBeInTheDocument();
    expect(screen.getByTestId('ticket-counts')).toHaveTextContent('1 ready · 1 stale · 1 blocked');

    const tsla = await screen.findByTestId('watch-TSLA');
    expect(within(tsla).getByText('Triggered')).toBeInTheDocument();
    expect(within(screen.getByTestId('watch-NVDA')).getByText('Waiting')).toBeInTheDocument();
    expect(within(screen.getByTestId('watch-AAPL')).getByText('Expired')).toBeInTheDocument();

    const meta = await screen.findByTestId('trade-META');
    expect(within(meta).getByText('+$27.30')).toBeInTheDocument();
    expect(within(meta).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '52');
    expect(within(meta).getByText('Flat by 15:55 ET')).toBeInTheDocument();

    const news = await screen.findAllByTestId('news-item');
    expect(news.length).toBeGreaterThan(0);
    expect(screen.getByText('Earnings')).toBeInTheDocument();
    expect(screen.getAllByText('Regulatory').length).toBeGreaterThan(0);
  });

  it('translates the dashboard and news tags to Spanish', async () => {
    await resetAppState({ lang: 'es' });
    renderApp('/');
    expect(await screen.findByText('Tickets listos')).toBeInTheDocument();
    expect(await screen.findByText('Resultados')).toBeInTheDocument();
    expect(await screen.findByText('Disparada')).toBeInTheDocument();
  });

  it('empty state: run the scanner, then run the pipeline for the best hit', async () => {
    server.use(http.get(`${url()}/tickets`, () => HttpResponse.json([])));
    const user = userEvent.setup();
    renderApp('/');
    const run = await screen.findByRole('button', { name: 'Run the scanner' });
    expect(screen.getByText("Run the scanner to find today's setups")).toBeInTheDocument();
    await user.click(run);
    expect(await screen.findByText('Found 3 setups in 5,873 charts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run pipeline for TSLA' }));
    expect(await screen.findByTestId('run-progress')).toBeInTheDocument();
  });

  it('shows the last session and next open when the market is closed', async () => {
    server.use(
      http.get(`${url()}/status`, () =>
        HttpResponse.json({
          ...fixtures.status,
          marketOpen: false,
          nextOpen: '2026-10-20T09:30:00-04:00',
        }),
      ),
    );
    renderApp('/');
    const notice = await screen.findByTestId('market-closed');
    expect(notice).toHaveTextContent('Showing the last session (Mon, Oct 19).');
    expect(notice).toHaveTextContent('Next open Tue, Oct 20, 09:30 ET.');
  });

  it('shows an engine offline state', async () => {
    server.use(
      http.get(`${url()}/status`, () => HttpResponse.error()),
      http.get(`${url()}/dashboard`, () => HttpResponse.error()),
    );
    renderApp('/');
    expect(await screen.findByText('The engine is offline')).toBeInTheDocument();
  });

  it('orders tickets ready -> stale -> blocked and picks the best scan hit', () => {
    expect(sortTickets(fixtures.tickets).map((t) => t.status)).toEqual([
      'ready',
      'stale',
      'blocked',
    ]);
    expect(bestHit(fixtures.scanHits)?.symbol).toBe('TSLA');
  });
});
