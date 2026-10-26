import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { setupMockServer } from '@/test/server';
import { engineEvents, useEngineEvents } from './events';
import {
  fetchTicketExport,
  usePipelineRun,
  useStartRun,
  useStatus,
  useTickets,
  useUpdateSettings,
} from './hooks';
import { fixtures } from './mock';
import { ApiError } from './client';
import { qk } from './queryKeys';

setupMockServer();

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe('API hooks against the mock engine', () => {
  it('loads status in demo mode', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      mode: 'demo',
      marketOpen: true,
      paper: true,
      tier: 'free',
    });
  });

  it('filters tickets by status', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useTickets('blocked'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((t) => t.symbol)).toEqual(['AMD']);
  });

  it('exports ticket text', async () => {
    const text = await fetchTicketExport(fixtures.TSLA_TICKET_ID, 'csv');
    expect(text.split('\n')[1]).toContain('TSLA,buy,8,market,364.18,358.32,370.04,46.88');
  });

  it('surfaces Problem codes as ApiError', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateSettings(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({
          ...fixtures.settings,
          limits: { ...fixtures.settings.limits, maxLossPerTradeUsd: 500 },
        })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe('validation_error');
  });

  it('run-all streams step.updated / run.updated / ticket.created into the cache', async () => {
    const { qc, wrapper } = setup();
    const created: string[] = [];
    const off = engineEvents.on('ticket.created', (t) => created.push(t.id));
    const { result } = renderHook(
      () => {
        useEngineEvents();
        return useStartRun();
      },
      { wrapper },
    );
    let runId = '';
    await act(async () => {
      const run = await result.current.mutateAsync({ mode: 'all', ticker: 'TSLA' });
      runId = run.id;
    });
    const { result: runResult } = renderHook(() => usePipelineRun(runId), { wrapper });
    await waitFor(
      () => {
        const run = qc.getQueryData<{ status: string; steps: { status: string }[] }>(qk.run(runId));
        expect(run?.status).toBe('check');
        expect(run?.steps.every((s) => s.status === 'done' || s.status === 'check')).toBe(true);
      },
      { timeout: 3000 },
    );
    expect(runResult.current.data?.ticketId).toBeTruthy();
    await waitFor(() => expect(created.length).toBe(1));
    off();
  });
});
