import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fixtures } from '@/api/mock';
import { renderApp, resetAppState } from '@/test/render';
import { setupMockServer } from '@/test/server';
import { useThemeStore } from '@/theme';

setupMockServer();

beforeEach(async () => {
  await resetAppState();
});

async function tslaCard() {
  return (await screen.findByRole('article', { name: 'Ticket BUY 8 TSLA' })) as HTMLElement;
}

describe('TicketCard', () => {
  it('renders Entry -> Stop loss -> Take profit as the largest neutral text', async () => {
    renderApp('/');
    const card = await tslaCard();
    const blocks = Array.from(card.querySelectorAll<HTMLElement>('[data-level]'));
    expect(blocks.map((b) => b.dataset.level)).toEqual(['entry', 'stop', 'target']);
    const values = blocks.map((b) => b.querySelector<HTMLElement>('.text-level')!);
    expect(values.map((v) => v.textContent)).toEqual(['364.18', '358.32', '370.04']);
    for (const v of values) {
      expect(v).toHaveClass('text-level', 'font-medium', 'text-text', 'tabular');
      expect(v.className).not.toMatch(/text-(profit|loss)/);
    }
    // colour only on the 3 px bar + dot
    expect(blocks[1].querySelector('.h-\\[3px\\]')).toHaveClass('bg-loss');
    expect(blocks[2].querySelector('.h-\\[3px\\]')).toHaveClass('bg-profit');
    // secondary line is small and muted
    const secondary = within(card).getByText('Max loss $46.88').parentElement!;
    expect(secondary).toHaveClass('text-xs', 'text-text-muted');
    expect(within(card).getByText('Odds: coin flip')).toBeInTheDocument();
    expect(within(card).getByText('Flat by 15:55 ET')).toBeInTheDocument();
    expect(within(card).getByText('Risk PASS')).toBeInTheDocument();
    expect(within(card).getByText(/CFD symbol and contract size may differ/)).toBeInTheDocument();
  });

  it('copies each value and the full ticket, with a locale-formatted toast', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const card = await tslaCard();
    await user.click(within(card).getByRole('button', { name: 'Copy Stop loss 358.32' }));
    expect(await navigator.clipboard.readText()).toBe('358.32');
    expect(await screen.findByText('Copied 358.32')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Copy full ticket' }));
    const text = await navigator.clipboard.readText();
    expect(text).toContain('BUY 8 TSLA');
    expect(text).toContain('Entry 364.18\nStop loss 358.32\nTake profit 370.04');
  });

  it('keyboard: 1/2/3 copy levels, C copies all, F opens the flow', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/');
    const card = await tslaCard();
    act(() => card.focus());
    await user.keyboard('1');
    expect(await navigator.clipboard.readText()).toBe('364.18');
    await user.keyboard('3');
    expect(await navigator.clipboard.readText()).toBe('370.04');
    await user.keyboard('2');
    expect(await navigator.clipboard.readText()).toBe('358.32');
    await user.keyboard('c');
    expect(await navigator.clipboard.readText()).toContain('Take profit 370.04');
    await user.keyboard('f');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/pipeline/${fixtures.TSLA_RUN_ID}`),
    );
  });

  it('shows the Spanish labels and toast and copies a dot decimal', async () => {
    await resetAppState({ lang: 'es' });
    const user = userEvent.setup();
    renderApp('/');
    const card = (await screen.findByRole('article', {
      name: 'Ticket COMPRA 8 TSLA',
    })) as HTMLElement;
    expect(within(card).getByText('Entrada')).toBeInTheDocument();
    expect(within(card).getByText('Stop loss')).toBeInTheDocument();
    expect(within(card).getByText('Take profit')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Copiar Take profit 370.04' }));
    expect(await navigator.clipboard.readText()).toBe('370.04');
    expect(await screen.findByText('370.04 copiado')).toBeInTheDocument();
  });

  it('collapses a blocked ticket with translated reasons and expands the detail', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const row = (await screen.findByRole('article', {
      name: 'Blocked ticket BUY 12 AMD',
    })) as HTMLElement;
    expect(within(row).getByText('Risk BLOCK')).toBeInTheDocument();
    expect(within(row).getByTestId('blocked-reasons')).toHaveTextContent(
      'This trade would go over your daily loss limit',
    );
    expect(row.querySelector('[data-level]')).toBeNull();
    const toggle = within(row).getByRole('button', { expanded: false });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(row).getByText(/97\.20 > 95\.00/)).toBeInTheDocument();
  });

  it('translates blocked reasons in Spanish', async () => {
    await resetAppState({ lang: 'es' });
    renderApp('/');
    const row = (await screen.findByRole('article', {
      name: 'Ticket bloqueado COMPRA 12 AMD',
    })) as HTMLElement;
    expect(within(row).getByTestId('blocked-reasons')).toHaveTextContent(
      'Esta operación superaría tu límite de pérdida diaria',
    );
  });

  it('shows a stale ticket muted with a re-run action', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const card = (await screen.findByRole('article', {
      name: 'Ticket BUY 23 NVDA',
    })) as HTMLElement;
    expect(card).toHaveAttribute('data-status', 'stale');
    expect(card.querySelector('[data-level]')!.parentElement!.parentElement).toHaveClass(
      'opacity-60',
    );
    await user.click(within(card).getByRole('button', { name: /Stale — re-run/ }));
    expect(await screen.findByText('Re-running the pipeline for NVDA')).toBeInTheDocument();
  });

  it('opens export, how-to and record-fill from the overflow menu', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const card = await tslaCard();
    await user.click(within(card).getByRole('button', { name: 'More ticket actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export…' }));
    await user.click(await screen.findByRole('radio', { name: 'CSV' }));
    expect(await screen.findByTestId('export-preview')).toHaveTextContent(
      'TSLA,buy,8,market,364.18,358.32,370.04',
    );
    await user.keyboard('{Escape}');

    await user.click(within(card).getByRole('button', { name: 'More ticket actions' }));
    await user.click(screen.getByRole('menuitem', { name: /How to enter/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('tab', { name: 'MetaTrader 4' })).toBeInTheDocument();
    expect(within(dlg).getByText(/Place Order/)).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(within(card).getByRole('button', { name: 'More ticket actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Record fill…' }));
    const fill = await screen.findByRole('dialog');
    expect(within(fill).getByLabelText('Quantity')).toHaveValue(8);
    expect(within(fill).getByLabelText('Fill price')).toHaveValue('364.18');
    await user.click(within(fill).getByRole('button', { name: 'Record fill' }));
    expect(await screen.findByText('Recorded BUY 8 TSLA at 364.18')).toBeInTheDocument();
  });

  it.each(['navy-teal', 'daylight'])(
    'renders with the %s preset using theme tokens',
    async (id) => {
      useThemeStore.setState({ activeId: id });
      renderApp('/');
      const card = await tslaCard();
      const value = card.querySelector('[data-level="entry"] .text-level')!;
      expect(value).toHaveClass('text-text');
      await waitFor(() =>
        expect(document.documentElement.style.getPropertyValue('--ls-text')).toBe(
          id === 'daylight' ? '#0F172A' : '#E6EDF7',
        ),
      );
    },
  );
});
