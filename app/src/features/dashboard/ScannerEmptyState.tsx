import { Play, Radar, RotateCw, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRunScanner, useStartRun, type PipelineRun } from '@/api';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/i18n/useFormat';
import { bestHit } from './scan';

/**
 * Empty Ready-tickets state: "Run the scanner" (POST /scanner/run), then offer
 * "Run pipeline" (run-all) for the best hit.
 */
export function ScannerEmptyState({ onRunStarted }: { onRunStarted: (run: PipelineRun) => void }) {
  const { t } = useTranslation('dashboard');
  const f = useFormat();
  const scan = useRunScanner();
  const start = useStartRun();
  const result = scan.data;
  const best = result?.hits ? bestHit(result.hits) : undefined;

  const runScan = () => scan.mutate({ kind: 'orb' });

  if (scan.isError) {
    return <ErrorState error={scan.error} onRetry={runScan} retrying={scan.isPending} />;
  }

  if (!result) {
    return (
      <EmptyState
        icon={Radar}
        title={t('empty.title')}
        description={t('empty.description')}
        className="rounded-lg border border-dashed border-border bg-surface"
        action={
          <Button variant="primary" onClick={runScan} disabled={scan.isPending}>
            {scan.isPending ? (
              <RotateCw className="animate-spin" aria-hidden />
            ) : (
              <Radar aria-hidden />
            )}
            {scan.isPending ? t('empty.scanning') : t('empty.run')}
          </Button>
        }
      />
    );
  }

  if (!best) {
    return (
      <EmptyState
        icon={SearchX}
        title={t('empty.noHits')}
        description={t('empty.noHitsHint')}
        className="rounded-lg border border-dashed border-border bg-surface"
        action={
          <Button variant="primary" onClick={runScan} disabled={scan.isPending}>
            <RotateCw className={scan.isPending ? 'animate-spin' : undefined} aria-hidden />
            {t('empty.scanAgain')}
          </Button>
        }
      />
    );
  }

  const pct = best.pctOverTrigger;
  return (
    <div
      className="rounded-lg border border-dashed border-border bg-surface px-6 py-6"
      data-testid="scan-result"
    >
      <p className="text-sm text-text-muted">
        {t('empty.found', {
          count: result.hits?.length ?? 0,
          scanned: f.number(result.scanned ?? 0, 0),
        })}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            {t('empty.best')}
          </p>
          <p className="text-lg font-semibold text-text">{best.symbol}</p>
          <p className="tabular text-xs text-text-muted">
            {t(`setups.${best.setup}`, { defaultValue: best.setup })}
            {pct != null &&
              ` · ${t(pct >= 0 ? 'empty.overTrigger' : 'empty.underTrigger', {
                pct: f.percent(Math.abs(pct), { fractionDigits: 2 }),
              })}`}
          </p>
        </div>
        <Button
          variant="primary"
          className="ml-auto"
          disabled={start.isPending}
          onClick={() =>
            start.mutate(
              { mode: 'all', ticker: best.symbol, setup: 'orb' },
              { onSuccess: (run) => onRunStarted(run) },
            )
          }
        >
          <Play aria-hidden />
          {t('empty.runPipeline', { symbol: best.symbol })}
        </Button>
      </div>
      {start.isError && <ErrorState compact className="mt-3" error={start.error} />}
      {(result.hits?.length ?? 0) > 1 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {result
            .hits!.filter((h) => h.symbol !== best.symbol)
            .map((h) => (
              <li key={h.symbol}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={start.isPending}
                  onClick={() =>
                    start.mutate(
                      { mode: 'all', ticker: h.symbol, setup: 'orb' },
                      { onSuccess: (run) => onRunStarted(run) },
                    )
                  }
                >
                  {t('empty.runPipeline', { symbol: h.symbol })}
                </Button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
