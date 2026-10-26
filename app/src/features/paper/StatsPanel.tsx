import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaperStats } from '@/api';
import { Card } from '@/components/Card';
import { KpiTile } from '@/components/KpiTile';
import { Skeleton } from '@/components/Skeleton';
import { useFormat } from '@/i18n/useFormat';

const EquityChart = lazy(() => import('./EquityChart'));

/** KPI tiles: total P/L, win rate, expectancy, profit factor, max drawdown, losing streak. */
export function StatsTiles({ stats, loading }: { stats?: PaperStats; loading?: boolean }) {
  const { t } = useTranslation('paper');
  const f = useFormat();
  const s = stats;
  const none = t('stats.none');
  const r = (v: number | null | undefined) =>
    v == null ? none : t('stats.r', { value: f.number(v) });
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="paper-stats">
      <KpiTile
        label={t('stats.pnl')}
        loading={loading}
        value={s ? f.money(s.totalPnl, { signed: true }) : none}
        trend={s ? (s.totalPnl > 0 ? 'up' : s.totalPnl < 0 ? 'down' : undefined) : undefined}
        sub={
          s
            ? t('stats.pnlSub', {
                start: f.money(s.startingBalanceUsd),
                end: f.money(s.endingEquityUsd),
              })
            : undefined
        }
      />
      <KpiTile
        label={t('stats.winRate')}
        loading={loading}
        value={s?.winRatePct != null ? f.percent(s.winRatePct, { fractionDigits: 1 }) : none}
        sub={
          s
            ? t('stats.winRateSub', { wins: s.wins, losses: s.losses, trades: s.trades })
            : undefined
        }
      />
      <KpiTile
        label={t('stats.expectancy')}
        loading={loading}
        value={s ? r(s.expectancyR) : none}
        sub={s ? t('stats.expectancySub', { win: r(s.avgWinR), loss: r(s.avgLossR) }) : undefined}
      />
      <KpiTile
        label={t('stats.profitFactor')}
        loading={loading}
        value={s?.profitFactor != null ? f.number(s.profitFactor) : none}
        sub={t('stats.profitFactorSub')}
      />
      <KpiTile
        label={t('stats.drawdown')}
        loading={loading}
        value={s ? f.money(s.maxDrawdownUsd) : none}
        sub={
          s
            ? t('stats.drawdownSub', { pct: f.percent(s.maxDrawdownPct, { fractionDigits: 1 }) })
            : undefined
        }
      />
      <KpiTile
        label={t('stats.streak')}
        loading={loading}
        value={s ? t('stats.streakValue', { count: s.longestLosingStreak }) : none}
        sub={s ? t('stats.skipped', { count: s.skipped }) : undefined}
      />
    </div>
  );
}

export function EquityCard({ stats, loading }: { stats?: PaperStats; loading?: boolean }) {
  const { t } = useTranslation('paper');
  const f = useFormat();
  const points = stats?.equityCurve ?? [];
  return (
    <Card title={t('equity.title')} subtitle={t('equity.subtitle')}>
      {loading ? (
        <Skeleton className="h-56 w-full" />
      ) : points.length < 2 ? (
        <p className="py-10 text-center text-sm text-text-muted">{t('equity.empty')}</p>
      ) : (
        <Suspense fallback={<Skeleton className="h-56 w-full" />}>
          <EquityChart
            points={points}
            startingBalance={stats!.startingBalanceUsd}
            formatMoney={f.money}
            ariaLabel={t('equity.aria', {
              start: f.money(stats!.startingBalanceUsd),
              end: f.money(stats!.endingEquityUsd),
            })}
          />
        </Suspense>
      )}
    </Card>
  );
}
