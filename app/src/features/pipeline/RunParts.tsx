import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  History,
  Lightbulb,
  ListChecks,
  Play,
  PlayCircle,
  RotateCw,
  TriangleAlert,
} from 'lucide-react';
import { STEP_KEYS, usePipelineRuns, useStartRun, type PipelineRun, type Step } from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';
import { num, obj, orderedSteps, stepIndex, str } from './model';
import { useRunErrorText } from './useRunErrorText';
import { useStepText } from './useStepText';

// ---------------------------------------------------------------- start panel

export function StartPanel({
  onCancel,
  onStarted,
}: {
  onCancel?: () => void;
  onStarted?: () => void;
}) {
  const { t } = useTranslation('pipeline');
  const navigate = useNavigate();
  const start = useStartRun();
  const [ticker, setTicker] = useState('');
  const [setup, setSetup] = useState<'orb' | 'level'>('orb');
  const [level, setLevel] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);

  const go = (mode: 'all' | 'step') => (e?: FormEvent) => {
    e?.preventDefault();
    const sym = ticker.trim().toUpperCase();
    if (sym && !/^[A-Z]{1,5}([.-][A-Z]{1,2})?$/.test(sym)) return setInvalid(t('start.badTicker'));
    if (setup === 'level' && !(Number(level) > 0)) return setInvalid(t('start.needLevel'));
    setInvalid(null);
    // mutateAsync: the run.updated event can re-render the page around this panel before the
    // response arrives, and per-call mutate callbacks are dropped once the panel unmounts.
    start
      .mutateAsync({
        mode,
        ticker: sym || undefined,
        setup,
        params: setup === 'level' ? { entry: { level: Number(level) } } : undefined,
      })
      .then((run) => {
        onStarted?.();
        navigate(`/pipeline/${run.id}`);
      })
      .catch(() => undefined);
  };

  return (
    <Card title={t('start.title')} subtitle={t('start.subtitle')} data-testid="start-panel">
      <form onSubmit={go('all')} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
          {t('start.ticker')}
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder={t('start.tickerPlaceholder')}
            maxLength={8}
            className="h-9 w-40 rounded-md border border-border bg-surface2 px-2 text-sm uppercase text-text focus-ring"
            name="ticker"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
          {t('start.setup')}
          <select
            value={setup}
            onChange={(e) => setSetup(e.target.value as 'orb' | 'level')}
            className="h-9 rounded-md border border-border bg-surface2 px-2 text-sm text-text focus-ring"
            name="setup"
          >
            <option value="orb">{t('setups.orb')}</option>
            <option value="level">{t('setups.level')}</option>
          </select>
        </label>
        {setup === 'level' && (
          <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
            {t('start.level')}
            <input
              type="number"
              step="0.01"
              min={0}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="h-9 w-32 rounded-md border border-border bg-surface2 px-2 text-sm text-text focus-ring"
              name="level"
            />
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              {t('common:actions.cancel')}
            </Button>
          )}
          <Button variant="secondary" onClick={() => go('step')()} disabled={start.isPending}>
            <ListChecks aria-hidden />
            {t('start.stepByStep')}
          </Button>
          <Button variant="primary" type="submit" disabled={start.isPending}>
            <PlayCircle aria-hidden />
            {t('start.runAll')}
          </Button>
        </div>
      </form>
      <p className="mt-2 text-xs text-text-muted">{t('start.hint')}</p>
      {invalid && (
        <p role="alert" className="mt-2 text-sm text-text">
          <TriangleAlert className="mr-1 inline h-4 w-4 text-warning" aria-hidden />
          {invalid}
        </p>
      )}
      {start.isError && <ErrorState error={start.error} compact className="mt-3" />}
    </Card>
  );
}

// ---------------------------------------------------------------- history

export function HistoryMenu({ currentId }: { currentId?: string }) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const runs = usePipelineRuns(50, { enabled: open });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <Button
        variant="outline"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((x) => !x)}
      >
        <History aria-hidden />
        {t('history.button')}
        <ChevronDown aria-hidden />
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={t('history.title')}
          className="absolute right-0 z-30 mt-1 w-[26rem] max-w-[90vw] rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          <p className="px-2 py-1.5 text-xs font-semibold text-text-muted">{t('history.title')}</p>
          {runs.isError && <ErrorState error={runs.error} compact onRetry={() => runs.refetch()} />}
          {runs.isLoading && (
            <p className="px-2 py-2 text-sm text-text-muted">{t('history.loading')}</p>
          )}
          {runs.data?.length === 0 && (
            <p className="px-2 py-2 text-sm text-text-muted">{t('history.empty')}</p>
          )}
          <ul className="max-h-80 overflow-auto">
            {runs.data?.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/pipeline/${r.id}`);
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface2 focus-ring',
                    r.id === currentId && 'bg-surface2',
                  )}
                  aria-current={r.id === currentId || undefined}
                >
                  <span className="tabular w-32 shrink-0 text-xs text-text-muted">
                    {f.marketDateTime(r.startedAt)}
                  </span>
                  <span className="w-14 shrink-0 font-semibold text-text">{r.ticker ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
                    {t(`modes.${r.mode}`)}
                  </span>
                  <StatusBadge status={r.status} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- banners

export function ReadOnlyBanner({ run, onLatest }: { run: PipelineRun; onLatest: () => void }) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  return (
    <div
      role="status"
      data-testid="readonly-banner"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-info/40 bg-info/5 px-4 py-2.5 text-sm"
    >
      <Eye className="h-4 w-4 shrink-0 text-info" aria-hidden />
      <span className="flex-1 text-text">
        {t('readOnly.text', { when: f.marketDateTime(run.startedAt) })}
      </span>
      <Button size="sm" variant="outline" onClick={onLatest}>
        {t('readOnly.latest')}
      </Button>
    </div>
  );
}

/** A run that stopped before the end: why, what is left, and "Check again". */
export function EarlyStopBanner({
  run,
  stop,
  readOnly,
  busy,
  primary,
  onRetry,
  onStepByStep,
}: {
  run: PipelineRun;
  stop: Step;
  readOnly: boolean;
  busy: boolean;
  primary: boolean;
  onRetry: () => void;
  onStepByStep?: () => void;
}) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const text = useStepText();
  const remaining = orderedSteps(run).filter((s) => s.status === 'pending').length;
  const waiting = stop.key === 'entry' && (stop.checks ?? []).includes('entry_waiting');
  const v = obj(stop.summary?.values);
  const o = obj(stop.outputs);
  const level = num(v.level) ?? num(o.level);
  const dist = num(v.distancePct);
  const why = waiting
    ? t('stop.entryWaiting', {
        symbol: run.ticker ?? '',
        level: level !== null ? f.price(level) : '–',
        distance: dist !== null ? f.percent(Math.abs(dist), { fractionDigits: 2 }) : '–',
      })
    : stop.status === 'error'
      ? t('stop.error', { message: stop.error ?? stop.summary?.outLine ?? '' })
      : (stop.checks ?? []).map(text.check).join('; ') || (str(stop.summary?.outLine) ?? '');
  return (
    <div
      role="status"
      data-testid="early-stop"
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3',
        stop.status === 'error' || stop.status === 'blocked'
          ? 'border-loss/40 bg-loss/5'
          : 'border-warning/40 bg-warning/5',
      )}
    >
      <TriangleAlert
        className={cn(
          'mt-0.5 h-5 w-5 shrink-0',
          stop.status === 'check' ? 'text-warning' : 'text-loss',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text">
          {t('stop.title', { step: t(`steps.${stop.key}`) })}
        </p>
        <p className="text-sm text-text">{why}</p>
        <p className="mt-0.5 text-xs text-text-muted">
          {t('stop.remaining', { count: remaining })}
          {waiting ? ` ${t('stop.waitingHint')}` : ''}
        </p>
      </div>
      {!readOnly && (
        <div className="flex shrink-0 items-center gap-2">
          {onStepByStep && (
            <Button size="sm" variant="ghost" onClick={onStepByStep}>
              <ListChecks aria-hidden />
              {t('stop.stepByStep')}
            </Button>
          )}
          <Button
            size="sm"
            variant={primary ? 'primary' : 'secondary'}
            onClick={onRetry}
            disabled={busy}
          >
            <RotateCw className={cn(busy && 'motion-safe:animate-spin')} aria-hidden />
            {waiting ? t('stop.checkAgain') : t('stop.runAgain', { step: t(`steps.${stop.key}`) })}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- wizard

export function WizardBar({
  step,
  run,
  busy,
  error,
  validation,
  onBack,
  onNext,
  onRun,
}: {
  step: Step;
  run: PipelineRun;
  busy: boolean;
  error: unknown;
  validation: string | null;
  onBack: () => void;
  onNext: () => void;
  onRun: () => void;
}) {
  const { t } = useTranslation('pipeline');
  const errorText = useRunErrorText();
  const [explain, setExplain] = useState(true);
  const idx = stepIndex(step.key);
  const laterDone = orderedSteps(run)
    .slice(idx + 1)
    .some((s) => s.status !== 'pending');
  const hasRun = step.status !== 'pending';
  return (
    <div className="mb-4 rounded-md border border-border bg-surface2 p-3" data-testid="wizard">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-text-muted">
          {t('wizard.progress', { n: idx + 1, total: STEP_KEYS.length })}
        </span>
        <button
          type="button"
          onClick={() => setExplain((x) => !x)}
          aria-expanded={explain}
          className="inline-flex items-center gap-1 rounded text-xs text-accent hover:underline focus-ring"
        >
          <Lightbulb className="h-3.5 w-3.5" aria-hidden />
          {t('wizard.explain')}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack} disabled={idx === 0}>
            <ChevronLeft aria-hidden />
            {t('common:actions.back')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={onRun}
            disabled={busy || step.status === 'running'}
          >
            {hasRun ? <RotateCw aria-hidden /> : <Play aria-hidden />}
            {busy || step.status === 'running'
              ? t('wizard.running')
              : hasRun
                ? t('wizard.runAgain')
                : t('wizard.run')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onNext}
            disabled={idx === STEP_KEYS.length - 1}
          >
            {t('common:actions.next')}
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
      {explain && (
        <p className="mt-2 text-sm text-text" data-testid="explain">
          {t(`explain.${step.key}`)}
        </p>
      )}
      {hasRun && laterDone && (
        <p className="mt-2 text-xs text-text-muted">{t('wizard.resetsLater')}</p>
      )}
      {validation && (
        <p role="alert" className="mt-2 text-sm text-text">
          <TriangleAlert className="mr-1 inline h-4 w-4 text-warning" aria-hidden />
          {validation}
        </p>
      )}
      {error != null && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-md border border-loss/40 bg-loss/5 px-3 py-2 text-sm text-text"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-loss" aria-hidden />
          <span>{errorText(error)}</span>
        </div>
      )}
    </div>
  );
}
