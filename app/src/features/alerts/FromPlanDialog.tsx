import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAlertsFromPlan, usePipelineRuns } from '@/api';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge, type BadgeStatus } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';
import { ApiErrorNote } from './ApiErrorNote';

const BADGE: Record<string, BadgeStatus> = {
  done: 'done',
  check: 'check',
  blocked: 'blocked',
  error: 'error',
  running: 'running',
  pending: 'pending',
};

/** Pick a recent pipeline run and create its stop, target and flat-by alerts in one go. */
export function FromPlanDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('alerts');
  const f = useFormat();
  const runs = usePipelineRuns(10, { enabled: open });
  const fromPlan = useAlertsFromPlan();
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRunId(null);
      fromPlan.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && !runId && runs.data?.length) setRunId(runs.data[0].id);
  }, [open, runId, runs.data]);

  const submit = async () => {
    if (!runId) return;
    try {
      const made = await fromPlan.mutateAsync(runId);
      toast(t('toast.fromPlan', { count: made.length }));
      onOpenChange(false);
    } catch {
      /* shown below */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('fromPlan.title')}</DialogTitle>
          <DialogDescription>{t('fromPlan.description')}</DialogDescription>
        </DialogHeader>
        {runs.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : !runs.data?.length ? (
          <EmptyState title={t('fromPlan.empty')} description={t('fromPlan.emptyHint')} />
        ) : (
          <div
            role="radiogroup"
            aria-label={t('fromPlan.pick')}
            className="max-h-72 space-y-2 overflow-y-auto"
          >
            {runs.data.map((r) => {
              const active = r.id === runId;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setRunId(r.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left focus-ring',
                    active ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface2',
                  )}
                >
                  <span className="w-16 font-semibold text-text">{r.ticker ?? '—'}</span>
                  <span className="flex-1 text-xs text-text-muted">
                    {t('fromPlan.runLine', {
                      setup: r.setup?.toUpperCase() ?? '—',
                      time: f.marketDateTime(r.startedAt),
                    })}
                  </span>
                  <StatusBadge size="sm" status={BADGE[r.status] ?? 'pending'} />
                </button>
              );
            })}
          </div>
        )}
        {fromPlan.isError && (
          <div className="mt-3">
            <ApiErrorNote error={fromPlan.error} />
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t('common:actions.cancel')}</Button>
          </DialogClose>
          <Button variant="primary" disabled={!runId || fromPlan.isPending} onClick={submit}>
            {fromPlan.isPending && <Loader2 className="animate-spin" aria-hidden />}
            {t('fromPlan.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
