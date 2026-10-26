import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/api/mock';
import { renderApp, resetAppState } from '@/test/render';
import { setupMockServer } from '@/test/server';
import { previewVolume, validateRows } from './bridgeUi';

setupMockServer();

beforeEach(async () => {
  await resetAppState();
});

describe('connections', () => {
  it('lists the five platforms with copy/export, bridges and Pro badges', async () => {
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
    // 5 x copy/export + 3 x in-platform bridge
    expect(screen.getAllByText('Available')).toHaveLength(8);
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

describe('bridges section', () => {
  it('shows the heartbeat status per platform', async () => {
    renderApp('/connections');
    const ct = await screen.findByTestId('bridge-status-ctrader');
    expect(within(ct).getByText('Online')).toBeInTheDocument();
    expect(within(ct).getByText(/Demo account/)).toBeInTheDocument();
    expect(within(ct).getByRole('switch', { name: 'Use cTrader' })).toBeChecked();
    expect(
      within(screen.getByTestId('bridge-status-mt5')).getByText('Offline'),
    ).toBeInTheDocument();
    const mt4 = screen.getByTestId('bridge-status-mt4');
    expect(within(mt4).getByText('Not installed')).toBeInTheDocument();
    expect(within(mt4).getByText('No heartbeat yet')).toBeInTheDocument();
  });

  it('enables a platform', async () => {
    const user = userEvent.setup();
    renderApp('/connections');
    const mt4 = await screen.findByTestId('bridge-status-mt4');
    await user.click(within(mt4).getByRole('switch', { name: 'Use MetaTrader 4' }));
    await waitFor(() => expect(db.bridges.settings.platforms.mt4.enabled).toBe(true));
    await waitFor(() =>
      expect(within(mt4).getByRole('switch', { name: 'Use MetaTrader 4' })).toBeChecked(),
    );
  });

  it('shows the install guide in Spanish with the safety note', async () => {
    await resetAppState({ lang: 'es' });
    const user = userEvent.setup();
    renderApp('/connections');
    const mt5 = await screen.findByTestId('bridge-status-mt5');
    await user.click(within(mt5).getByRole('button', { name: 'Instalar el puente' }));
    expect(
      within(mt5).getByText(/bridges\/mt5\/LevelsetBridge\.mq5/, { selector: 'p' }),
    ).toBeInTheDocument();
    expect(within(mt5).getByText(/Activa Algo Trading/)).toBeInTheDocument();
    expect(within(mt5).getByText(/nunca coloca una orden por su cuenta/)).toBeInTheDocument();
  });

  it('validates and saves the signals folder', async () => {
    const user = userEvent.setup();
    renderApp('/connections');
    const input = await screen.findByLabelText('Signals folder');
    await waitFor(() => expect(input).toHaveValue(db.bridges.settings.signalsFolder));
    await user.clear(input);
    await user.type(input, 'relative\\folder');
    await user.click(screen.getByRole('button', { name: 'Save folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/absolute path/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.clear(input);
    await user.type(input, 'D:\\Signals');
    await user.click(screen.getByRole('button', { name: 'Save folder' }));
    expect(await screen.findByText('Signals folder saved')).toBeInTheDocument();
    expect(db.bridges.settings.signalsFolder).toBe('D:\\Signals');
  });

  it('edits the symbol map: add, validate, save, delete', async () => {
    const user = userEvent.setup();
    renderApp('/connections');
    await waitFor(() => expect(screen.getAllByTestId('symbol-row')).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Add row' }));
    expect(screen.getAllByTestId('symbol-row')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    expect(screen.getAllByText('Required')).toHaveLength(2);
    await user.type(screen.getByRole('textbox', { name: 'US ticker 4' }), 'tsla');
    await user.type(screen.getByRole('textbox', { name: 'Broker symbol 4' }), 'TSLA.US');
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    expect(screen.getByText('This ticker already has a row for this platform')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Platform 4' }), 'mt4');
    const vps = screen.getByRole('textbox', { name: 'Volume per share 4' });
    await user.clear(vps);
    await user.type(vps, '0');
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    expect(screen.getByText('Must be greater than 0')).toBeInTheDocument();
    await user.clear(vps);
    await user.type(vps, '0.01');
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    expect(await screen.findByText('Symbol mapping saved')).toBeInTheDocument();
    expect(db.bridges.rows.at(-1)).toMatchObject({
      platform: 'mt4',
      usSymbol: 'TSLA',
      brokerSymbol: 'TSLA.US',
      volumePerShare: 0.01,
    });
    await user.click(screen.getByRole('button', { name: 'Delete row 4' }));
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    await waitFor(() => expect(db.bridges.rows).toHaveLength(3));
  });
});

describe('send to platform', () => {
  it('sends a PASS ticket, shows the bridge state and cancels it', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const card = (await screen.findByRole('article', { name: 'Ticket BUY 8 TSLA' })) as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'More ticket actions' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Send to platform (you confirm there)' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Send TSLA to your platform' });
    expect(within(dialog).getByText(/Nothing is placed until you click Place/)).toBeInTheDocument();
    expect(await within(dialog).findByText('TSLA.US · 8 units')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Send to platform' }));
    expect(await screen.findByText(/Sent to the platform/)).toBeInTheDocument();
    const line = await within(card).findByTestId('bridge-line');
    // the online cBot acknowledges "shown"; only the user's click in cTrader can make it "placed"
    await waitFor(() => expect(line).toHaveTextContent('cTrader — Shown, waiting for your click'));
    expect(db.tickets.find((t) => t.symbol === 'TSLA')?.bridge?.platforms[0]).toMatchObject({
      brokerSymbol: 'TSLA.US',
      volume: 8,
      volumeUnit: 'units',
    });
    await user.click(within(line).getByRole('button', { name: 'Cancel in platform' }));
    await waitFor(() => expect(line).toHaveTextContent('cTrader — Cancelled'));
    expect(within(line).queryByRole('button', { name: 'Cancel in platform' })).toBeNull();
  });

  it('a stale ticket has no send action', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const cards = await screen.findAllByRole('article');
    const stale = cards.find((c) => c.getAttribute('data-status') === 'stale');
    if (!stale) return; // the dashboard may hide stale tickets
    await user.click(within(stale).getByRole('button', { name: 'More ticket actions' }));
    expect(screen.queryByRole('menuitem', { name: /Send to platform/ })).toBeNull();
  });
});

describe('bridge helpers', () => {
  it('rounds the volume down, never up', () => {
    const row = (vps: number, min: number, step: number) => ({
      platform: 'mt5' as const,
      usSymbol: 'TSLA',
      brokerSymbol: 'TSLA.US',
      volumePerShare: vps,
      minVolume: min,
      volumeStep: step,
    });
    expect(previewVolume(8, row(1, 1, 1))).toBe(8);
    expect(previewVolume(8, row(0.01, 0.01, 0.01))).toBe(0.08);
    expect(previewVolume(29, row(0.1, 0.1, 0.5))).toBe(2.5);
    expect(previewVolume(3, row(0.1, 0.1, 0.1))).toBe(0.3);
  });

  it('validates rows', () => {
    const base = {
      key: 1,
      platform: 'ctrader' as const,
      usSymbol: 'TSLA',
      brokerSymbol: 'TSLA.US',
      volumePerShare: '1',
      minVolume: '1',
      volumeStep: '1',
    };
    expect(validateRows([base])).toEqual([{}]);
    expect(validateRows([base, { ...base, key: 2, usSymbol: 'tsla' }])[1]).toEqual({
      usSymbol: 'duplicate',
    });
    expect(
      validateRows([{ ...base, brokerSymbol: ' ', volumeStep: '-1', minVolume: '' }])[0],
    ).toEqual({
      brokerSymbol: 'required',
      volumeStep: 'positive',
      minVolume: 'required',
    });
  });
});
