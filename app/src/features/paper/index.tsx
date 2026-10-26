import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePaperAccounts, usePaperStats, useStatus } from '@/api';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { AiCoachCard } from '@/features/ai';
import { Skeleton } from '@/components/Skeleton';
import { AccountBar } from './AccountBar';
import { Breakdown } from './Breakdown';
import { Compare } from './Compare';
import { activeOf, toRange, type PaperSelection } from './model';
import { ConstraintNotes } from './Notes';
import { Positions } from './Positions';
import { EquityCard, StatsTiles } from './StatsPanel';
import { TradeLog } from './TradeLog';

/**
 * Paper account (v1.1, docs/V1.1-PRD.md §3): every signal followed automatically, with slippage.
 * Account switcher + period/date selectors drive every panel below (stats, equity curve,
 * breakdowns, trade log, "Signals vs. you"); CSV export uses the same range.
 */
export default function PaperPage() {
  const { t } = useTranslation('paper');
  const accounts = usePaperAccounts();
  const status = useStatus();
  const [sel, setSel] = useState<PaperSelection>({ preset: 'all' });

  const account = accounts.data?.find((a) => a.id === sel.accountId) ?? activeOf(accounts.data);
  const todayEt = status.data?.nowEt.slice(0, 10);
  const range = useMemo(
    () => toRange({ ...sel, accountId: account?.id }, todayEt),
    [sel, account?.id, todayEt],
  );
  const stats = usePaperStats(range, { enabled: !!account });

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t('title')} description={t('description')} className="mb-0" />
      {accounts.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : accounts.isError || !account ? (
        <ErrorState
          title={t('loadFailed')}
          error={accounts.error}
          onRetry={() => void accounts.refetch()}
        />
      ) : (
        <>
          <AccountBar
            accounts={accounts.data!}
            account={account}
            selection={{ ...sel, accountId: account.id }}
            onChange={setSel}
            range={range}
          />
          {stats.isError ? (
            <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
          ) : (
            <StatsTiles stats={stats.data} loading={stats.isLoading} />
          )}
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="space-y-5 xl:col-span-2">
              <EquityCard stats={stats.data} loading={stats.isLoading} />
              <Positions accountId={account.id} />
            </div>
            <div className="space-y-5">
              <Breakdown range={range} />
              <ConstraintNotes />
            </div>
          </div>
          <TradeLog range={range} />
          <Compare range={range} />
          <AiCoachCard accountId={account.id} />
        </>
      )}
    </div>
  );
}
