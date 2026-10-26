import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { getEngineInfo } from '@/api';
import { db } from '@/api/mock';
import { renderApp, resetAppState } from '@/test/render';
import { server, setupMockServer } from '@/test/server';
import { EMPTY_DRAFT, draftToCreate, draftToPatch, validateAlertDraft } from './model';

setupMockServer();

beforeEach(async () => {
  await resetAppState();
});

describe('alert form validation', () => {
  it('requires the fields each type needs', () => {
    expect(validateAlertDraft({ ...EMPTY_DRAFT, type: 'above' })).toEqual({
      symbol: 'required',
      level: 'required',
    });
    expect(
      validateAlertDraft({ ...EMPTY_DRAFT, type: 'stop', symbol: 'tesla!', level: '-2' }),
    ).toEqual({ symbol: 'symbol', level: 'positive' });
    expect(validateAlertDraft({ ...EMPTY_DRAFT, type: 'pct_move', symbol: 'TSLA' })).toEqual({
      pct: 'required',
    });
    expect(validateAlertDraft({ ...EMPTY_DRAFT, type: 'time' })).toEqual({ time: 'required' });
    expect(validateAlertDraft({ ...EMPTY_DRAFT, type: 'time', time: '25:00' })).toEqual({
      time: 'time',
    });
    expect(validateAlertDraft({ ...EMPTY_DRAFT, type: 'flat_by' })).toEqual({});
    expect(validateAlertDraft({ ...EMPTY_DRAFT, type: 'open_bell' })).toEqual({});
    expect(
      validateAlertDraft({ ...EMPTY_DRAFT, type: 'open_bell', note: 'x'.repeat(121) }),
    ).toEqual({ note: 'noteLength' });
  });

  it('builds create and patch bodies with only the fields the type uses', () => {
    const d = { ...EMPTY_DRAFT, type: 'pct_move' as const, symbol: 'nvda', pct: '3', level: '9' };
    expect(draftToCreate(d)).toEqual({ type: 'pct_move', symbol: 'NVDA', pct: 3 });
    expect(draftToPatch(d)).toEqual({
      type: 'pct_move',
      symbol: 'NVDA',
      level: null,
      pct: 3,
      time: null,
      note: null,
    });
  });
});

describe('alerts page', () => {
  it('lists alerts with icon + label status', async () => {
    renderApp('/alerts');
    const row = await screen.findByTestId('alert-row-alr_meta_stop');
    expect(within(row).getByText('Stop')).toBeInTheDocument();
    expect(within(row).getByText('META')).toBeInTheDocument();
    expect(within(row).getByText('704.40')).toBeInTheDocument();
    expect(within(row).getByText('Armed')).toBeInTheDocument();
    const bell = screen.getByTestId('alert-row-alr_open_bell');
    expect(within(bell).getByText('Rung')).toBeInTheDocument();
  });

  it('creates a custom alert and shows translated validation errors', async () => {
    const user = userEvent.setup();
    renderApp('/alerts');
    await screen.findByTestId('alert-row-alr_meta_stop');
    await user.click(screen.getAllByRole('button', { name: /Custom alert/ })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create alert' }));
    expect(within(dialog).getAllByText('Required')).toHaveLength(2);

    await user.type(within(dialog).getByLabelText('Ticker'), 'nvda');
    await user.type(within(dialog).getByLabelText('Price level (USD)'), '187.5');
    await user.click(within(dialog).getByRole('button', { name: 'Create alert' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(db.alerts.some((a) => a.symbol === 'NVDA' && a.level === 187.5)).toBe(true);
    expect(await screen.findByText('187.50')).toBeInTheDocument();
  });

  it('shows the engine invalid_alert error translated', async () => {
    server.use(
      http.post(`${getEngineInfo().url}/alerts`, () =>
        HttpResponse.json(
          { title: 'Alert not created', code: 'invalid_alert' },
          { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp('/alerts');
    await screen.findByTestId('alert-row-alr_meta_stop');
    await user.click(screen.getAllByRole('button', { name: /Custom alert/ })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Alert type'), 'time');
    await user.type(within(dialog).getByLabelText('Time (ET)'), '15:30');
    await user.click(within(dialog).getByRole('button', { name: 'Create alert' }));
    expect(
      await within(dialog).findByText(
        "This alert isn't valid. Check the type and the level or time.",
      ),
    ).toBeInTheDocument();
  });

  it('edits, re-arms and deletes alerts', async () => {
    const user = userEvent.setup();
    renderApp('/alerts');
    const row = await screen.findByTestId('alert-row-alr_meta_stop');

    await user.click(within(row).getByRole('button', { name: 'Edit Stop alert' }));
    const dialog = await screen.findByRole('dialog');
    const level = within(dialog).getByLabelText('Price level (USD)');
    await user.clear(level);
    await user.type(level, '705');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(db.alerts.find((a) => a.id === 'alr_meta_stop')?.level).toBe(705);
    expect(await within(row).findByText('705.00')).toBeInTheDocument();

    const bell = screen.getByTestId('alert-row-alr_open_bell');
    await user.click(within(bell).getByRole('button', { name: 'Re-arm Opening bell alert' }));
    await waitFor(() =>
      expect(db.alerts.find((a) => a.id === 'alr_open_bell')?.status).toBe('armed'),
    );
    expect(
      await within(screen.getByTestId('alert-row-alr_open_bell')).findByText('Armed'),
    ).toBeInTheDocument();

    await user.click(
      within(screen.getByTestId('alert-row-alr_meta_target')).getByRole('button', {
        name: 'Delete Target alert',
      }),
    );
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('Delete this alert?')).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(screen.queryByTestId('alert-row-alr_meta_target')).not.toBeInTheDocument(),
    );
    expect(db.alerts.some((a) => a.id === 'alr_meta_target')).toBe(false);
  });

  it('adds stop, target and flat-by alerts from a recent run', async () => {
    const user = userEvent.setup();
    renderApp('/alerts');
    await screen.findByTestId('alert-row-alr_meta_stop');
    const before = db.alerts.length;
    await user.click(screen.getByRole('button', { name: /Add from plan/ }));
    const dialog = await screen.findByRole('dialog');
    const radios = await within(dialog).findAllByRole('radio');
    expect(radios.length).toBeGreaterThan(0);
    const tsla = radios.find((r) => r.textContent?.includes('TSLA'))!;
    await user.click(tsla);
    await user.click(within(dialog).getByRole('button', { name: 'Add 3 alerts' }));
    await waitFor(() => expect(db.alerts.length).toBe(before + 3));
    expect(db.alerts.slice(-3).map((a) => a.type)).toEqual(['stop', 'target', 'flat_by']);
  });

  it('persists the notification toggles in prefs', async () => {
    const user = userEvent.setup();
    renderApp('/alerts');
    const sound = await screen.findByRole('switch', { name: 'Sound' });
    expect(sound).toHaveAttribute('aria-checked', 'true');
    await user.click(sound);
    expect(sound).toHaveAttribute('aria-checked', 'false');
    const { getAlertPrefs } = await import('./alertPrefs');
    expect(getAlertPrefs().sound).toBe(false);
    // browser / mock mode: Windows notifications are desktop-only
    expect(screen.getByRole('switch', { name: 'Windows notifications' })).toBeDisabled();
    await act(async () => undefined);
  });
});
