import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/api/mock';
import { toast } from '@/components/ui/toaster';
import { renderApp, resetAppState } from '@/test/render';
import { setupMockServer } from '@/test/server';
import { validateApiKey, validateSecUserAgent } from './validation';

const core = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    invoke: vi.fn(async (cmd: string, args: { name: string; value?: string }) => {
      if (cmd === 'set_secret') store.set(args.name, args.value!);
      else if (cmd === 'has_secret') return store.has(args.name);
      else if (cmd === 'delete_secret') store.delete(args.name);
      return undefined;
    }),
  };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: core.invoke }));

setupMockServer();

const w = window as unknown as Record<string, unknown>;

beforeEach(async () => {
  await resetAppState();
  core.invoke.mockClear();
  core.store.clear();
  toast.dismiss();
});
afterEach(() => {
  delete w.__TAURI_INTERNALS__;
});

describe('account & limits', () => {
  it('saves the full limits form with a success toast', async () => {
    const user = userEvent.setup();
    renderApp('/settings/account');
    const cap = await screen.findByLabelText('Position cap (% of account)');
    expect(screen.getByText(/4 or more day trades within 5 business days/)).toBeInTheDocument();
    await user.clear(cap);
    await user.type(cap, '40');
    const maxOrder = screen.getByLabelText('Max order size (USD)');
    await user.clear(maxOrder);
    await user.type(maxOrder, '3000');
    await user.click(screen.getByRole('switch', { name: 'Require a stop loss' }));
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Limits saved')).toBeInTheDocument();
    expect(db.settings.limits).toMatchObject({
      maxPositionPct: 40,
      maxOrderUsd: 3000,
      requireStop: false,
    });
  });

  it('shows translated validation errors and does not save', async () => {
    const user = userEvent.setup();
    renderApp('/settings/account');
    const cap = await screen.findByLabelText('Position cap (% of account)');
    await user.clear(cap);
    await user.type(cap, '150');
    const perTrade = screen.getByLabelText('Max loss per trade (USD)');
    await user.clear(perTrade);
    await user.type(perTrade, '500');
    await user.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Enter a value from 0 to 100')).toBeInTheDocument();
    expect(screen.getByText("Can't be higher than the daily loss limit")).toBeInTheDocument();
    expect(db.settings.limits.maxPositionPct).not.toBe(150);
  });

  it("lists today's fills and deletes one after confirming", async () => {
    const user = userEvent.setup();
    renderApp('/settings/account');
    const del = await screen.findByRole('button', { name: 'Delete fill Buy 6 META' });
    await user.click(del);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Buy 6 META at 712.40 will be removed/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete fill' }));
    expect(await screen.findByText('Fill deleted')).toBeInTheDocument();
    expect(db.fills.some((f) => f.id === 'fill_meta_1')).toBe(false);
    expect(await screen.findByText('No fills recorded today')).toBeInTheDocument();
  });
});

describe('data & SEC', () => {
  it('validates and saves the SEC user agent; demo mode is read-only', async () => {
    const user = userEvent.setup();
    renderApp('/settings/data');
    const field = await screen.findByLabelText('Name and email (User-Agent)');
    expect(screen.getByText('Why does the SEC ask for this?')).toBeInTheDocument();
    expect(screen.getByTestId('demo-mode-value')).toBeInTheDocument();
    expect(
      screen.getByText('Real-time data is planned as a future Pro feature.'),
    ).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, 'Jane Doe');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Include a contact email, e.g. Jane Doe jane@example.com'),
    ).toBeInTheDocument();
    await user.type(field, ' jane@example.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('SEC identity saved')).toBeInTheDocument();
    expect(db.settings.data.secUserAgent).toBe('Jane Doe jane@example.com');
  });

  it('validator rules', () => {
    expect(validateSecUserAgent('')).toBeNull();
    expect(validateSecUserAgent('Acme ops@acme.io')).toBeNull();
    expect(validateSecUserAgent('Acme')).toBe('email');
    expect(validateSecUserAgent(`a@b.co ${'x'.repeat(200)}`)).toBe('tooLong');
  });
});

describe('AI (optional)', () => {
  it('explains that keys are desktop-only in browser / mock mode', async () => {
    renderApp('/settings/ai');
    expect(await screen.findByTestId('ai-desktop-only')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Use AI summaries' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(core.invoke).not.toHaveBeenCalled();
  });

  it('saves the key through the Tauri command, never shows it back, and removes it', async () => {
    w.__TAURI_INTERNALS__ = {};
    const user = userEvent.setup();
    renderApp('/settings/ai');
    const field = await screen.findByLabelText('API key');
    await waitFor(() => expect(field).toBeEnabled());
    await user.type(field, 'not-a-key');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(
      await screen.findByText("That doesn't look like a Claude API key (sk-ant-…)"),
    ).toBeInTheDocument();
    expect(core.invoke).not.toHaveBeenCalledWith('set_secret', expect.anything());

    await user.clear(field);
    const secret = 'sk-ant-api03-abcdefghijklmnop';
    await user.type(field, secret);
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(await screen.findByText('Key saved')).toBeInTheDocument();
    expect(core.invoke).toHaveBeenCalledWith('set_secret', {
      name: 'claude_api_key',
      value: secret,
    });
    expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument();
    expect(JSON.stringify(localStorage)).not.toContain(secret);

    await user.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(await screen.findByLabelText('API key')).toBeInTheDocument();
    expect(core.invoke).toHaveBeenCalledWith('delete_secret', { name: 'claude_api_key' });
  });

  it('api key validator', () => {
    expect(validateApiKey('')).toBe('required');
    expect(validateApiKey('sk-ant-short')).toBe('format');
    expect(validateApiKey(' sk-ant-api03-abcdefghijklmnop ')).toBeNull();
  });
});
