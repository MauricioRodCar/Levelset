/**
 * AI assistant (v1.1): hooks for /ai/*. Optional and off by default. The UI never sees the
 * Claude key: Settings saves it through the Tauri shell, which pushes it to the engine.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApi, unwrap } from './client';
import type {
  AiAnswer,
  AiChatRequest,
  AiCoachRequest,
  AiExplainRequest,
  AiSettings,
  AiSettingsUpdate,
  AiStatus,
} from './types';

export const aiKeys = {
  all: ['ai'] as const,
  status: ['ai', 'status'] as const,
  settings: ['ai', 'settings'] as const,
};

export function useAiStatus(opts?: { enabled?: boolean }) {
  return useQuery<AiStatus>({
    queryKey: aiKeys.status,
    queryFn: () => unwrap(getApi().GET('/ai/status')),
    staleTime: 15_000,
    ...opts,
  });
}

export function useAiSettings() {
  return useQuery<AiSettings>({
    queryKey: aiKeys.settings,
    queryFn: () => unwrap(getApi().GET('/ai/settings')),
  });
}

export function useUpdateAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AiSettingsUpdate) => unwrap(getApi().PATCH('/ai/settings', { body })),
    onSuccess: (data) => {
      qc.setQueryData(aiKeys.settings, data);
      void qc.invalidateQueries({ queryKey: aiKeys.status });
    },
  });
}

/** Every answer changes this month's spend: refresh the status afterwards (success or error). */
function useAiMutation<B>(call: (body: B) => Promise<AiAnswer>) {
  const qc = useQueryClient();
  return useMutation<AiAnswer, Error, B>({
    mutationFn: call,
    onSettled: () => void qc.invalidateQueries({ queryKey: aiKeys.status }),
  });
}

export function useAiExplain() {
  return useAiMutation((body: AiExplainRequest) => unwrap(getApi().POST('/ai/explain', { body })));
}

export function useAiCoach() {
  return useAiMutation((body: AiCoachRequest) => unwrap(getApi().POST('/ai/coach', { body })));
}

export function useAiChat() {
  return useAiMutation((body: AiChatRequest) => unwrap(getApi().POST('/ai/chat', { body })));
}

/** Re-read AI status, e.g. after a key save: the shell pushes the key to the engine in the background. */
export function useRefreshAiStatus() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: aiKeys.status });
}
