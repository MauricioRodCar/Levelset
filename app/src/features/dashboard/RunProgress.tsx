import { CheckCircle2, Loader2, TriangleAlert, Workflow, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { usePipelineRun, STEP_KEYS } from '@/api';
import { Button } from '@/components/ui/button';

/** Live banner for a run started from the dashboard (updated by SSE through the query cache). */
export function RunProgress({
  runId,
  ticker,
  onDismiss,
}: {
  runId: string;
  ticker: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const { t: tp } = useTranslation('pipeline');
  const { t: tt } = useTranslation('tickets');
  const navigate = useNavigate();
  const q = usePipelineRun(runId);
  const run = q.data;
  const running = !run || run.status === 'running' || run.status === 'pending';
  const steps = run?.steps ?? [];
  const current =
    steps.find((s) => s.status === 'running') ?? steps.find((s) => s.status === 'pending');
  const n = current ? STEP_KEYS.indexOf(current.key) + 1 : steps.length;
  const failed = run?.status === 'error' || run?.status === 'blocked';
  const symbol = run?.ticker ?? ticker;

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
      data-testid="run-progress"
    >
      {running ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-info" aria-hidden />
      ) : failed ? (
        <TriangleAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-profit" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text">
          {running
            ? t('run.running', { symbol })
            : failed
              ? t('run.failed', { symbol })
              : t('run.finished', { symbol })}
        </p>
        {running && current && (
          <p className="text-xs text-text-muted">
            {t('run.step', { n, step: tp(`steps.${current.key}`) })}
          </p>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={() => navigate(`/pipeline/${runId}`)}>
        <Workflow aria-hidden />
        {tt('actions.viewFlow')}
      </Button>
      {!running && (
        <Button size="icon-sm" variant="ghost" onClick={onDismiss} aria-label={t('run.dismiss')}>
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
