import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert } from '@/api';
import { mockEmit } from '@/api/mock';
import { renderApp, resetAppState } from '@/test/render';
import { setupMockServer } from '@/test/server';
import { toast } from '@/components/ui/toaster';
import { setAlertPref } from './alertPrefs';

const plugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => 'granted'),
  sendNotification: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-notification', () => plugin);

setupMockServer();

const rung: Alert = {
  id: 'alr_meta_stop',
  type: 'stop',
  symbol: 'META',
  level: 704.4,
  status: 'rung',
  createdAt: '2026-10-19T09:50:20-04:00',
  rungAt: '2026-10-19T10:20:00-04:00',
};

const w = window as unknown as Record<string, unknown>;

beforeEach(async () => {
  await resetAppState();
  vi.clearAllMocks();
  toast.dismiss(); // sonner keeps toasts in a global store between tests
});
afterEach(() => {
  delete w.__TAURI_INTERNALS__;
  toast.dismiss();
  plugin.isPermissionGranted.mockReset().mockResolvedValue(false);
  plugin.requestPermission.mockReset().mockResolvedValue('granted');
});

async function ring() {
  // the shell mounts the SSE subscription; wait until the mock EventSource is open
  await screen.findAllByText('Dashboard');
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    mockEmit('alert.rung', rung);
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('notification on alert.rung', () => {
  it('shows an in-app toast only in browser / mock mode', async () => {
    renderApp('/');
    await ring();
    expect(await screen.findByText('META alert: Stop')).toBeInTheDocument();
    expect(screen.getByText('META hit your stop at 704.40')).toBeInTheDocument();
    expect(plugin.sendNotification).not.toHaveBeenCalled();
  });

  it('sends a Windows notification in the desktop app, asking permission once', async () => {
    w.__TAURI_INTERNALS__ = {};
    renderApp('/');
    await ring();
    await waitFor(() =>
      expect(plugin.sendNotification).toHaveBeenCalledWith({
        title: 'META alert: Stop',
        body: 'META hit your stop at 704.40',
      }),
    );
    expect(plugin.requestPermission).toHaveBeenCalledTimes(1);

    plugin.isPermissionGranted.mockResolvedValue(false);
    plugin.requestPermission.mockResolvedValue('denied');
    await act(async () => {
      mockEmit('alert.rung', { ...rung, id: 'other' });
      await new Promise((r) => setTimeout(r, 0));
    });
    // already asked: no second OS prompt
    expect(plugin.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('respects the Windows notifications toggle', async () => {
    w.__TAURI_INTERNALS__ = {};
    setAlertPref('desktop', false);
    renderApp('/');
    await ring();
    expect(await screen.findByText('META alert: Stop')).toBeInTheDocument();
    expect(plugin.sendNotification).not.toHaveBeenCalled();
  });
});
