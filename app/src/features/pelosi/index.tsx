import { useState, type ReactNode } from 'react';
import { Briefcase, Eye, FileText, Info, Landmark, RefreshCw, TimerOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useCongressSettings,
  useCongressTrades,
  useRefreshCongress,
  useUpdateCongressSettings,
  type CongressQuery,
  type CongressTrade,
  type CongressTradeType,
} from '@/api';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Label, Select, Switch } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { useErrorMessage } from '@/components/useErrorMessage';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';
import { useResearchFormat } from '../analyst/format';

const TYPES: CongressTradeType[] = ['buy', 'sell', 'exchange'];
const EMPTY: CongressQuery = {};

/** Congress trades (trader-pelosi): House PTR rows, filters, watchlist flags and the alert toggle. */
export default function PelosiPage() {
  const { t } = useTranslation('congress');
  const f = useFormat();
  const errorMessage = useErrorMessage();
  const [filters, setFilters] = useState<CongressQuery>(EMPTY);
  const feed = useCongressTrades(filters);
  const settings = useCongressSettings();
  const save = useUpdateCongressSettings();
  const refresh = useRefreshCongress();

  const set = <K extends keyof CongressQuery>(k: K, v: CongressQuery[K]) =>
    setFilters((cur) => ({ ...cur, [k]: v || undefined }));

  const onRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: (r) =>
        toast(r.newFilings ? t('refreshDone', { count: r.newFilings }) : t('refreshNone')),
      onError: (e) => toast.error(errorMessage(e)),
    });

  const notify = settings.data?.notifyOnWatchlist ?? true;
  const lastChecked = feed.data?.lastCheckedAt;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button variant="primary" onClick={onRefresh} disabled={refresh.isPending}>
            <RefreshCw className={cn(refresh.isPending && 'animate-spin')} aria-hidden />
            {t('refresh')}
          </Button>
        }
      />

      <div
        role="note"
        data-testid="congress-note"
        className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm text-text"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <span>{t('note')}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Switch
            id="congress-notify"
            checked={notify}
            disabled={!settings.data || save.isPending}
            onCheckedChange={(v) =>
              save.mutate(
                { notifyOnWatchlist: v },
                { onError: (e) => toast.error(errorMessage(e)) },
              )
            }
            aria-describedby="congress-notify-hint"
          />
          <div>
            <Label htmlFor="congress-notify">{t('notify.label')}</Label>
            <p id="congress-notify-hint" className="text-xs text-text-muted">
              {t('notify.hint')}
            </p>
          </div>
        </div>
        <span className="text-xs text-text-muted">
          {lastChecked
            ? t('lastChecked', { time: f.marketDateTime(lastChecked) })
            : t('neverChecked')}
        </span>
      </div>

      <Card title={t('filters.label')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field id="cf-member" label={t('filters.member')}>
            <Input
              id="cf-member"
              value={filters.member ?? ''}
              placeholder={t('filters.memberPlaceholder')}
              onChange={(e) => set('member', e.target.value)}
            />
          </Field>
          <Field id="cf-ticker" label={t('filters.ticker')}>
            <Input
              id="cf-ticker"
              className="uppercase"
              value={filters.ticker ?? ''}
              placeholder={t('filters.tickerPlaceholder')}
              onChange={(e) => set('ticker', e.target.value.trim().toUpperCase())}
            />
          </Field>
          <Field id="cf-type" label={t('filters.type')}>
            <Select
              id="cf-type"
              value={filters.type ?? ''}
              onChange={(e) => set('type', (e.target.value || undefined) as CongressTradeType)}
            >
              <option value="">{t('filters.typeAll')}</option>
              {TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`types.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="cf-from" label={t('filters.from')}>
            <Input
              id="cf-from"
              type="date"
              value={filters.from ?? ''}
              onChange={(e) => set('from', e.target.value)}
            />
          </Field>
          <Field id="cf-to" label={t('filters.to')}>
            <Input
              id="cf-to"
              type="date"
              value={filters.to ?? ''}
              onChange={(e) => set('to', e.target.value)}
            />
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="cf-watch"
                checked={!!filters.watchlistOnly}
                onCheckedChange={(v) => set('watchlistOnly', v === true)}
              />
              <Label htmlFor="cf-watch" className="text-xs">
                {t('filters.watchlistOnly')}
              </Label>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => setFilters(EMPTY)}
              disabled={filters === EMPTY}
            >
              {t('filters.clear')}
            </Button>
          </div>
        </div>
      </Card>

      {feed.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : feed.isError ? (
        <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
      ) : feed.data ? (
        <>
          <TradesTable trades={feed.data.trades} />
          {feed.data.unreadFilings.length > 0 && (
            <Card title={t('unread.title')} subtitle={t('unread.description')}>
              <ul className="divide-y divide-border text-sm" data-testid="unread-filings">
                {feed.data.unreadFilings.map((u) => (
                  <li key={u.docId} className="flex flex-wrap items-center gap-3 py-2">
                    <FileText className="h-4 w-4 text-text-muted" aria-hidden />
                    <span className="font-medium text-text">{u.member}</span>
                    {u.district && <span className="text-text-muted">{u.district}</span>}
                    <DayText day={u.filedDate} />
                    <a
                      href={u.filingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto text-accent underline-offset-4 hover:underline focus-ring"
                    >
                      {t('unread.open')}
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function DayText({ day }: { day: string }) {
  const rf = useResearchFormat();
  return <span className="tabular text-text-muted">{rf.day(day)}</span>;
}

function tradeDetail(
  tr: CongressTrade,
  t: (k: string, o?: Record<string, unknown>) => string,
  rf: ReturnType<typeof useResearchFormat>,
  money: (v: number) => string,
): string | null {
  const o = tr.option;
  if (o)
    return t(o.exercised ? 'optionExercised' : 'option', {
      contracts: o.contracts ?? '',
      kind: t(`optionKinds.${o.kind}`),
      strike: money(o.strike),
      expires: o.expires ? rf.day(o.expires) : rf.na,
    });
  if (tr.shares != null) return t('shares', { count: tr.shares });
  return null;
}

function TradesTable({ trades }: { trades: CongressTrade[] }) {
  const { t } = useTranslation('congress');
  const rf = useResearchFormat();
  const f = useFormat();
  if (!trades.length)
    return (
      <Card>
        <EmptyState icon={Landmark} title={t('empty.title')} description={t('empty.description')} />
      </Card>
    );
  const th = 'px-3 py-2 text-left font-medium';
  return (
    <Card title={t('count', { count: trades.length })} flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-sm" data-testid="congress-table">
          <thead className="border-y border-border text-xs text-text-muted">
            <tr>
              <th scope="col" className={th}>
                {t('cols.member')}
              </th>
              <th scope="col" className={th}>
                {t('cols.owner')}
              </th>
              <th scope="col" className={th}>
                {t('cols.ticker')}
              </th>
              <th scope="col" className={th}>
                {t('cols.type')}
              </th>
              <th scope="col" className={th}>
                {t('cols.amount')}
              </th>
              <th scope="col" className={th}>
                {t('cols.tradeDate')}
              </th>
              <th scope="col" className={th}>
                {t('cols.filed')}
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                {t('cols.days')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {trades.map((tr) => {
              const detail = tradeDetail(tr, t, rf, f.money);
              return (
                <tr key={tr.id} data-testid={`ptr-${tr.id}`} className="align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium text-text">{tr.member}</div>
                    {tr.district && <div className="text-xs text-text-muted">{tr.district}</div>}
                  </td>
                  <td className="px-3 py-2 text-text">{t(`owners.${tr.owner}`)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-text">{tr.ticker ?? '—'}</span>
                      {tr.inWatchlist && <Flag icon={Eye} label={t('flags.watchlist')} />}
                      {tr.inPositions && <Flag icon={Briefcase} label={t('flags.position')} />}
                    </div>
                    <div
                      className="max-w-[16rem] truncate text-xs text-text-muted"
                      title={tr.assetName}
                    >
                      {tr.assetName}
                    </div>
                    {detail && <div className="text-xs text-text-muted">{detail}</div>}
                  </td>
                  <td className="px-3 py-2 text-text">
                    {tr.partial ? t('types.partial') : t(`types.${tr.type}`)}
                  </td>
                  <td className="tabular px-3 py-2 text-text">{tr.amountRange}</td>
                  <td className="tabular px-3 py-2 text-text">{rf.day(tr.tradeDate)}</td>
                  <td className="px-3 py-2">
                    <a
                      href={tr.filingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="tabular text-accent underline-offset-4 hover:underline focus-ring"
                      aria-label={`${t('openFiling')} (${rf.day(tr.filedDate)})`}
                    >
                      {rf.day(tr.filedDate)}
                    </a>
                  </td>
                  <td className="tabular px-3 py-2 text-right text-text">
                    {tr.daysToDisclose != null ? t('days', { count: tr.daysToDisclose }) : rf.na}
                    {tr.late && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-text">
                        <TimerOff className="h-3 w-3 text-warning" aria-hidden />
                        {t('late')}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Flag({ icon: Icon, label }: { icon: typeof Eye; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-text">
      <Icon className="h-3 w-3 text-primary" aria-hidden />
      {label}
    </span>
  );
}
