import { Hourglass, Moon, TimerOff, Zap, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWatchlist, type WatchItem } from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { PriceValue } from '@/components/PriceValue';
import { Skeleton } from '@/components/Skeleton';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';

const STATE: Record<WatchItem['entryState'], { icon: LucideIcon; tone: string }> = {
  triggered: { icon: Zap, tone: 'text-profit' },
  waiting: { icon: Hourglass, tone: 'text-info' },
  expired: { icon: TimerOff, tone: 'text-text-muted' },
  not_open: { icon: Moon, tone: 'text-text-muted' },
};

/** Watchlist with the entry state per ticker (icon + label, never colour alone) and % change. */
export function WatchlistPanel() {
  const { t } = useTranslation('dashboard');
  const f = useFormat();
  const q = useWatchlist({ refetchInterval: 30_000 });

  return (
    <Card title={t('watchlist.title')} flush aria-label={t('watchlist.title')}>
      {q.isLoading ? (
        <div className="space-y-2 px-4 pb-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <div className="px-4 pb-4">
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !q.data?.length ? (
        <p className="px-4 pb-4 text-sm text-text-muted">{t('watchlist.empty')}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {q.data.map((w) => {
            const { icon: Icon, tone } = STATE[w.entryState];
            return (
              <li
                key={w.symbol}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2"
                data-testid={`watch-${w.symbol}`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text">{w.symbol}</div>
                  {w.setup && (
                    <div
                      className="truncate text-xs text-text-muted"
                      title={t(`setups.${w.setup}`, { defaultValue: w.setup })}
                    >
                      {t(`setupsShort.${w.setup}`, { defaultValue: w.setup })}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm">
                    <Icon className={cn('h-4 w-4 shrink-0', tone)} aria-hidden />
                    <span className="text-text">{t(`watchlist.state.${w.entryState}`)}</span>
                  </div>
                  {w.entryState === 'waiting' && w.distancePct != null && (
                    <div className="tabular truncate pl-5 text-xs text-text-muted">
                      {t('watchlist.distance', {
                        pct: f.percent(w.distancePct, { fractionDigits: 2 }),
                      })}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <PriceValue value={w.price} size="sm" />
                  <div className="text-xs" aria-label={t('watchlist.change')}>
                    {w.changePct != null ? (
                      <span
                        className={cn(
                          'tabular',
                          w.changePct > 0
                            ? 'text-profit'
                            : w.changePct < 0
                              ? 'text-loss'
                              : 'text-text-muted',
                        )}
                      >
                        {f.percent(w.changePct, { signed: true, fractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
