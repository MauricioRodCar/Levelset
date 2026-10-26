import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, FileSearch, KeyRound, Search, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, useAnalyst, useWatchlist, type AnalystFiling, type AnalystReport } from '@/api';
import { Card } from '@/components/Card';
import { AiExplainButton } from '@/features/ai';
import { EarningsBadge } from '@/components/EarningsBadge';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { KpiTile } from '@/components/KpiTile';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';
import { useResearchFormat } from './format';
import { changeText, type T } from './model';

const QuartersChart = lazy(() => import('./QuartersChart'));

const TICKER = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;

/** Analyst (trader-analyst): reported quarters from SEC EDGAR for one company. */
export default function AnalystPage() {
  const { t } = useTranslation('analyst');
  const [params, setParams] = useSearchParams();
  const symbol = (params.get('symbol') ?? '').trim().toUpperCase();
  const [draft, setDraft] = useState(symbol);
  const [invalid, setInvalid] = useState(false);
  const q = useAnalyst(symbol);
  const watch = useWatchlist();

  useEffect(() => setDraft(symbol), [symbol]);

  const open = (s: string) => {
    const next = s.trim().toUpperCase();
    if (!TICKER.test(next)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setParams({ symbol: next });
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    open(draft);
  };

  const err = q.error instanceof ApiError ? q.error : null;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')} />

      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3" role="search">
        <div className="w-44">
          <Label htmlFor="analyst-ticker">{t('search.label')}</Label>
          <Input
            id="analyst-ticker"
            className="mt-1 uppercase"
            value={draft}
            placeholder={t('search.placeholder')}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'analyst-ticker-error' : undefined}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Button type="submit" variant="primary">
          <Search aria-hidden />
          {t('search.submit')}
        </Button>
        {!!watch.data?.length && (
          <div className="flex flex-wrap items-center gap-1.5 pb-1 text-xs text-text-muted">
            <span>{t('search.suggestions')}</span>
            {watch.data.map((w) => (
              <Button
                key={w.symbol}
                type="button"
                size="sm"
                variant={w.symbol === symbol ? 'secondary' : 'ghost'}
                className="h-7 px-2"
                onClick={() => open(w.symbol)}
              >
                {w.symbol}
              </Button>
            ))}
          </div>
        )}
        {invalid && (
          <p id="analyst-ticker-error" role="alert" className="w-full text-xs text-loss">
            {t('search.invalid')}
          </p>
        )}
      </form>

      {!symbol ? (
        <Card>
          <EmptyState
            icon={FileSearch}
            title={t('empty.title')}
            description={t('empty.description')}
          />
        </Card>
      ) : q.isLoading ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-60 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : err?.code === 'sec_identity_missing' ? (
        <SecIdentityPrompt />
      ) : err?.code === 'no_sec_filer' ? (
        <Card>
          <EmptyState
            icon={SearchX}
            title={t('notFiler.title', { symbol })}
            description={t('notFiler.description')}
          />
        </Card>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : q.data ? (
        <ReportView report={q.data} />
      ) : null}

      <p className="text-xs text-text-muted">{t('disclaimer')}</p>
    </div>
  );
}

export function SecIdentityPrompt() {
  const { t } = useTranslation('analyst');
  return (
    <Card>
      <EmptyState
        icon={KeyRound}
        title={t('secPrompt.title')}
        description={t('secPrompt.description')}
        action={
          <Link to="/settings/data" className={buttonVariants({ variant: 'secondary' })}>
            {t('secPrompt.action')}
          </Link>
        }
      />
    </Card>
  );
}

function ReportView({ report }: { report: AnalystReport }) {
  const { t } = useTranslation('analyst');
  const rf = useResearchFormat();
  const f = useFormat();
  const quarters = report.quarters;

  return (
    <div className="space-y-4" data-testid="analyst-report">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-text">
          {report.entity ?? report.symbol}{' '}
          <span className="font-normal text-text-muted">({report.symbol})</span>
        </h2>
        <EarningsBadge symbol={report.symbol} />
        <span className="text-xs text-text-muted">
          {t('header.cik', { cik: report.cik })} · {t('header.source', { source: report.source })} ·{' '}
          {t('header.fetched', { time: f.marketDateTime(report.fetchedAt) })}
        </span>
      </div>

      <AiExplainButton
        kind="analyst_quarter"
        symbol={report.symbol}
        quarterEnd={report.quarters[0]?.end}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title={t('changes.title')}>
          {report.changes.length ? (
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-text" data-testid="changes">
              {report.changes.map((c, i) => (
                <li key={`${c.code}-${i}`} data-code={c.code}>
                  {changeText(c, t as T, rf)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">{t('changes.empty')}</p>
          )}
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3" aria-label={t('ttm.title')} role="group">
            <KpiTile label={t('ttm.revenue')} value={rf.big(report.ttm.revenue)} />
            <KpiTile label={t('ttm.netIncome')} value={rf.big(report.ttm.netIncome)} />
            <KpiTile label={t('ttm.eps')} value={rf.eps(report.ttm.epsDiluted)} />
          </div>
          <p className="-mt-2 text-xs text-text-muted">{t('ttm.title')}</p>
          <FilingsCard latest={report.latestReport} earnings={report.earnings8k} />
        </div>
      </div>

      <Card
        title={t('chart.title')}
        actions={
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-accent/60" aria-hidden />
              {t('chart.revenue')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded bg-primary" aria-hidden />
              {t('chart.eps')}
            </span>
          </div>
        }
      >
        {quarters.length >= 2 ? (
          <Suspense fallback={<Skeleton className="h-60 w-full" />}>
            <QuartersChart
              quarters={quarters}
              ariaLabel={t('chart.aria')}
              formatRevenue={rf.big}
              formatEps={rf.eps}
              formatDay={rf.day}
            />
          </Suspense>
        ) : (
          <p className="text-sm text-text-muted">{t('chart.empty')}</p>
        )}
      </Card>

      <QuartersTable report={report} />
    </div>
  );
}

function FilingsCard({
  latest,
  earnings,
}: {
  latest: AnalystFiling | null;
  earnings: AnalystFiling | null;
}) {
  const { t } = useTranslation('analyst');
  const rf = useResearchFormat();
  const link = (href: string, label: string) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline focus-ring"
    >
      {label}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  );
  return (
    <Card title={t('filings.title')}>
      {!latest && !earnings ? (
        <p className="text-sm text-text-muted">{t('filings.none')}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {earnings && (
            <li>
              <div className="text-text">
                {t('filings.earnings8k', { date: rf.day(earnings.filed) })}
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                {earnings.pressReleaseUrl &&
                  link(earnings.pressReleaseUrl, t('filings.pressRelease'))}
                {link(earnings.url, t('filings.filing'))}
              </div>
            </li>
          )}
          {latest && (
            <li>
              <div className="text-text">
                {t('filings.report', {
                  form: latest.form,
                  period: rf.day(latest.period),
                  date: rf.day(latest.filed),
                })}
              </div>
              <div className="text-xs">{link(latest.url, t('filings.open'))}</div>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

function Yoy({ value, pts }: { value: number | null; pts?: boolean }) {
  const rf = useResearchFormat();
  const { t } = useTranslation('analyst');
  if (value == null) return <span className="text-text-muted">{rf.na}</span>;
  const text = pts ? t('table.pts', { value: rf.pts(value) }) : rf.signedPct(value);
  return (
    <span
      className={cn(
        'tabular',
        value > 0 ? 'text-profit' : value < 0 ? 'text-loss' : 'text-text-muted',
      )}
    >
      {text}
    </span>
  );
}

function QuartersTable({ report }: { report: AnalystReport }) {
  const { t } = useTranslation('analyst');
  const rf = useResearchFormat();
  const th = 'px-3 py-2 text-right font-medium';
  const td = 'px-3 py-2 text-right tabular';
  return (
    <Card title={t('table.title')} subtitle={t('table.caption')} flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm" data-testid="quarters-table">
          <thead className="border-y border-border text-xs text-text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {t('table.quarter')}
              </th>
              <th scope="col" className={th}>
                {t('table.revenue')}
              </th>
              <th scope="col" className={th}>
                {t('table.yoy')}
              </th>
              <th scope="col" className={th}>
                {t('table.grossMargin')}
              </th>
              <th scope="col" className={th}>
                {t('table.operatingMargin')}
              </th>
              <th scope="col" className={th}>
                {t('table.netMargin')}
              </th>
              <th scope="col" className={th}>
                {t('table.netIncome')}
              </th>
              <th scope="col" className={th}>
                {t('table.yoy')}
              </th>
              <th scope="col" className={th}>
                {t('table.eps')}
              </th>
              <th scope="col" className={th}>
                {t('table.yoy')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {report.quarters.map((q) => (
              <tr key={q.end}>
                <th scope="row" className="px-3 py-2 text-left font-medium text-text">
                  <div className="flex items-center gap-1.5">
                    {q.fiscal}
                    {q.derived && (
                      <SimpleTooltip label={t('table.derivedTip')}>
                        <span
                          tabIndex={0}
                          className="cursor-help rounded border border-border px-1 text-[10px] font-normal text-text-muted focus-ring"
                        >
                          {t('table.derived')}
                        </span>
                      </SimpleTooltip>
                    )}
                  </div>
                  <div className="text-xs font-normal text-text-muted">
                    {t('table.end')} {rf.day(q.end)}
                  </div>
                </th>
                <td className={td}>{rf.big(q.revenue)}</td>
                <td className={td}>
                  <Yoy value={q.revenueYoyPct} />
                </td>
                <td className={td}>
                  <div>{rf.pct(q.grossMarginPct)}</div>
                  <div className="text-xs">
                    <Yoy value={q.grossMarginYoyPts} pts />
                  </div>
                </td>
                <td className={td}>
                  <div>{rf.pct(q.operatingMarginPct)}</div>
                  <div className="text-xs">
                    <Yoy value={q.operatingMarginYoyPts} pts />
                  </div>
                </td>
                <td className={td}>
                  <div>{rf.pct(q.netMarginPct)}</div>
                  <div className="text-xs">
                    <Yoy value={q.netMarginYoyPts} pts />
                  </div>
                </td>
                <td className={td}>{rf.big(q.netIncome)}</td>
                <td className={td}>
                  <Yoy value={q.netIncomeYoyPct} />
                </td>
                <td className={td}>{rf.eps(q.epsDiluted)}</td>
                <td className={td}>
                  <Yoy value={q.epsDilutedYoyPct} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
