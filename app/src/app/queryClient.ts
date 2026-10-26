import { QueryClient } from '@tanstack/react-query';
import { isNetworkError } from '@/api/client';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        // Don't hammer an engine that is down; the status bar offers a manual retry.
        retry: (count, err) => !isNetworkError(err) && count < 2,
      },
    },
  });
}
