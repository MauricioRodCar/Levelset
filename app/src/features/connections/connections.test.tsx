import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp, resetAppState } from '@/test/render';
import { setupMockServer } from '@/test/server';

setupMockServer();

beforeEach(async () => {
  await resetAppState();
});

describe('connections', () => {
  it('lists the five platforms with copy/export and later badges', async () => {
    renderApp('/connections');
    for (const name of [
      'cTrader',
      'MetaTrader 4',
      'MetaTrader 5',
      'Alpaca',
      'Interactive Brokers',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getAllByText('Coming in v1.1')).toHaveLength(3);
    expect(screen.getAllByText('Pro')).toHaveLength(2);
    expect(screen.getAllByText('Tickets: copy / export')).toHaveLength(5);
    expect(screen.getByText(/never connects to your broker or sends orders/)).toBeInTheDocument();
  });

  it('expands the step-by-step guide, in Spanish too', async () => {
    await resetAppState({ lang: 'es' });
    const user = userEvent.setup();
    renderApp('/connections');
    const card = screen.getByTestId('platform-mt5');
    await user.click(within(card).getByRole('button', { name: 'Cómo ingresar una orden' }));
    expect(within(card).getAllByRole('listitem').length).toBeGreaterThan(5);
    expect(within(card).getByText(/Pega el stop loss en Stop Loss/)).toBeInTheDocument();
  });
});
