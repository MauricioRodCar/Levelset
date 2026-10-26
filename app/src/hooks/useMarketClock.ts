import { useStatus } from '@/api';
import { useNow } from './useNow';

/** Remembers when a given nowEt value was first seen, so a pinned demo clock keeps ticking. */
let anchor: { nowEt: string; seenAt: number } | null = null;

/**
 * Ticking market clock anchored to the engine's `nowEt`.
 * The demo engine pins nowEt (10:15 ET) and returns the same value on every poll; we keep the
 * first time we saw that value so the clock advances smoothly instead of jumping back each refetch.
 * Falls back to the local clock while the engine is unreachable.
 */
export function useMarketClock(): Date {
  const { data, dataUpdatedAt } = useStatus();
  const now = useNow(1000);
  if (!data) return new Date(now);
  if (!anchor || anchor.nowEt !== data.nowEt)
    anchor = { nowEt: data.nowEt, seenAt: dataUpdatedAt || now };
  return new Date(new Date(data.nowEt).getTime() + (now - anchor.seenAt));
}
