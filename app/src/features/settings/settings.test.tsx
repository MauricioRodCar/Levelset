import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp, resetAppState } from '@/test/render';
import { setupMockServer } from '@/test/server';
import { useThemeStore } from '@/theme';
import { validateLimits, DEFAULT_SETTINGS } from './components/accountLimits';

setupMockServer();

beforeEach(async () => {
  await resetAppState();
});

describe('settings shell', () => {
  it('has all six tabs', async () => {
    const user = userEvent.setup();
    renderApp('/settings/data');
    for (const name of [
      'Account & limits',
      'Appearance',
      'Language',
      'Data & SEC',
      'AI (optional)',
      'About',
    ]) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(await screen.findByText('SEC EDGAR identity')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'About' }));
    expect(await screen.findByText(/Copyright \(c\) 2026 Jake Schincariol/)).toBeInTheDocument();
  });
});

describe('appearance', () => {
  it('applies a preset and writes CSS variables', async () => {
    const user = userEvent.setup();
    renderApp('/settings/appearance');
    await user.click(screen.getByRole('button', { name: /Daylight/ }));
    expect(useThemeStore.getState().activeId).toBe('daylight');
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--ls-bg')).toBe('#F7F9FC'),
    );
    expect(document.documentElement.style.getPropertyValue('--ls-bg-rgb')).toBe('247 249 252');
  });

  it('forks a preset on edit and warns about low contrast', async () => {
    renderApp('/settings/appearance');
    expect(screen.getByText('All colour pairs meet WCAG AA contrast.')).toBeInTheDocument();
    const textMuted = screen.getByLabelText('Muted text');
    fireEvent.change(textMuted, { target: { value: '#1E2A44' } });
    await waitFor(() => expect(useThemeStore.getState().custom).toHaveLength(1));
    expect(useThemeStore.getState().custom[0].tokens.textMuted).toBe('#1E2A44');
    expect(
      await screen.findByText(/Muted text on Background: contrast 1\.\d:1 \(needs 4.5:1\)/),
    ).toBeInTheDocument();
  });
});

describe('account limits validation', () => {
  it('accepts defaults and rejects inconsistent limits', () => {
    expect(validateLimits(DEFAULT_SETTINGS)).toEqual({});
    const bad = {
      ...DEFAULT_SETTINGS,
      limits: {
        ...DEFAULT_SETTINGS.limits,
        maxLossPerTradeUsd: 500,
        maxDailyLossUsd: 100,
        noEntriesAfter: '09:00',
      },
    };
    expect(validateLimits(bad)).toMatchObject({
      maxLossPerTradeUsd: 'aboveDaily',
      noEntriesAfter: 'window',
    });
  });
});
