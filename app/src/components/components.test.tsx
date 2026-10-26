import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, resetAppState } from '@/test/render';
import { CopyButton } from './CopyButton';
import { PriceValue } from './PriceValue';
import { StatusBadge } from './StatusBadge';
import { TicketLevels } from './ticket/TicketLevels';

beforeEach(async () => {
  await resetAppState();
});

describe('StatusBadge', () => {
  it.each(['done', 'check', 'ready', 'blocked', 'error', 'running', 'pass', 'block'] as const)(
    '%s renders an icon and a text label',
    (status) => {
      const { container } = renderWithProviders(<StatusBadge status={status} />);
      const badge = container.querySelector(`[data-status="${status}"]`)!;
      expect(badge.querySelector('svg')).not.toBeNull();
      expect(badge.textContent?.trim().length).toBeGreaterThan(0);
    },
  );
});

describe('PriceValue', () => {
  it('uses tabular numerals and locale formatting', () => {
    renderWithProviders(<PriceValue value={358.32} size="level" />);
    const el = screen.getByText('358.32');
    expect(el).toHaveClass('tabular');
  });
  it('shows a dash for missing values', () => {
    renderWithProviders(<PriceValue value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('copy', () => {
  it('CopyButton copies and toasts "Copied 358.32"', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    renderWithProviders(<CopyButton value="358.32" />);
    await user.click(screen.getByRole('button', { name: 'Copy 358.32' }));
    expect(write).toHaveBeenCalledWith('358.32');
    expect((await screen.findAllByText('Copied 358.32')).length).toBeGreaterThan(0);
  });

  it('TicketLevels renders Entry -> Stop loss -> Take profit and copies on click', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    const { container } = renderWithProviders(
      <TicketLevels entry={364.18} stop={358.32} target={370.04} />,
    );
    const order = [...container.querySelectorAll('[data-level]')].map((n) =>
      n.getAttribute('data-level'),
    );
    expect(order).toEqual(['entry', 'stop', 'target']);
    expect(screen.getByText('Stop loss')).toBeInTheDocument();
    expect(screen.getByText('Take profit')).toBeInTheDocument();
    // Levels stay in the neutral text colour, never profit/loss.
    const stopValue = screen.getByText('358.32');
    expect(stopValue).toHaveClass('text-text', 'text-level', 'tabular');
    expect(stopValue.className).not.toMatch(/text-(loss|profit)/);
    expect(screen.getByText('-5.86')).toBeInTheDocument();
    expect(screen.getByText('+5.86')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Copy Stop loss 358.32/ }));
    expect(write).toHaveBeenCalledWith('358.32');
    // sonner keeps toasts from earlier tests in its global store, so there may be several.
    expect((await screen.findAllByText('Copied 358.32')).length).toBeGreaterThan(0);
  });
});
