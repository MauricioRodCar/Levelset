import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ListChecks, Plus, Workflow } from 'lucide-react';
import {
  STEP_KEYS,
  usePipelineRun,
  usePipelineRuns,
  useRunStep,
  type PipelineRun,
  type Step,
  type StepKey,
} from '@/api';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/i18n/useFormat';
import { defaultSelection, nextKey, orderedSteps, stoppedAt } from './model';
import type { Params } from './ParamsForm';
import { EarlyStopBanner, HistoryMenu, ReadOnlyBanner, StartPanel, WizardBar } from './RunParts';
import { StepDetail } from './StepDetail';
import { StepGrid } from './StepGrid';

/**
 * Pipeline (docs/SCREENS.md S2). /pipeline shows the latest run (or the start panel when there is
 * none); /pipeline/:runId shows that run. Runs other than the latest open read-only (audit trail).
 * Live progress arrives over SSE (step.updated / run.updated update the run cache).
 */
export default function PipelinePage() {
  const { t } = useTranslation('pipeline');
  const { runId } = useParams();
  const navigate = useNavigate();
  const runs = usePipelineRuns(50);
  const latestId = runs.data?.[0]?.id;
  const id = runId ?? latestId;
  const run = usePipelineRun(id);
  const [starting, setStarting] = useState(false);

  useEffect(() => setStarting(false), [runId]);

  const header = (actions?: ReactNode, description?: ReactNode) => (
    <PageHeader
      title={t('title')}
      description={description ?? t('description')}
      actions={actions}
    />
  );

  if (!runId && runs.isLoading) return <PageSkeleton header={header()} />;
  if (!runId && runs.isError)
    return (
      <div>
        {header()}
        <ErrorState error={runs.error} onRetry={() => runs.refetch()} />
      </div>
    );
  if (!id)
    return (
      <div className="space-y-4">
        {header(<HistoryMenu />)}
        <StartPanel />
        <EmptyState icon={Workflow} title={t('empty.title')} description={t('empty.text')} />
      </div>
    );
  if (run.isLoading) return <PageSkeleton header={header(<HistoryMenu currentId={id} />)} />;
  if (run.isError || !run.data)
    return (
      <div>
        {header(<HistoryMenu currentId={id} />)}
        <ErrorState error={run.error} onRetry={() => run.refetch()} />
      </div>
    );

  const readOnly = !!runId && latestId !== undefined && latestId !== runId;
  return (
    <RunView
      key={run.data.id}
      run={run.data}
      readOnly={readOnly}
      starting={starting}
      onStart={() => setStarting(true)}
      onCancelStart={() => setStarting(false)}
      onLatest={() => navigate('/pipeline')}
      header={header}
    />
  );
}

function PageSkeleton({ header }: { header: ReactNode }) {
  return (
    <div>
      {header}
      <div className="grid grid-cols-4 gap-6">
        {STEP_KEYS.map((k) => (
          <Skeleton key={k} className="h-28" />
        ))}
      </div>
      <Skeleton className="mt-6 h-64" />
    </div>
  );
}

function RunView({
  run,
  readOnly,
  starting,
  onStart,
  onCancelStart,
  onLatest,
  header,
}: {
  run: PipelineRun;
  readOnly: boolean;
  starting: boolean;
  onStart: () => void;
  onCancelStart: () => void;
  onLatest: () => void;
  header: (actions?: ReactNode, description?: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const [search, setSearch] = useSearchParams();
  const steps = orderedSteps(run);
  const fromUrl = search.get('step') as StepKey | null;
  const selected: StepKey =
    fromUrl && (STEP_KEYS as readonly string[]).includes(fromUrl) ? fromUrl : defaultSelection(run);
  const select = (key: StepKey) =>
    setSearch(
      (p) => {
        p.set('step', key);
        return p;
      },
      { replace: true },
    );
  const step = steps.find((s) => s.key === selected)!;
  const runStep = useRunStep(run.id);
  const [wizardOn, setWizardOn] = useState(run.mode === 'step');
  const wizard = !readOnly && wizardOn;
  const [drafts, setDrafts] = useState<Partial<Record<StepKey, Params>>>({});
  const draft = drafts[selected] ?? step.params ?? {};
  const [validation, setValidation] = useState<string | null>(null);
  const stop = stoppedAt(run);
  const running = run.status === 'running';

  // the error belongs to the step it was raised for
  useEffect(() => {
    runStep.reset();
    setValidation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const runSelected = (key: StepKey = selected, params?: Params, onDone?: (s: Step) => void) => {
    const p = params ?? drafts[key];
    for (const k of ['stop', 'target'])
      if (typeof p?.[k] === 'string' && /:$|:\D/.test(p[k] as string))
        return setValidation(t('params.missingValue', { field: t(`params.fields.${k}`) }));
    setValidation(null);
    runStep.mutate({ stepKey: key, params: p }, { onSuccess: onDone });
  };

  const description = useMemo(
    () => (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-text">{run.ticker ?? t('run.noTicker')}</span>
        <span aria-hidden>·</span>
        <span>{t(`setups.${run.setup}`, { defaultValue: run.setup })}</span>
        <span aria-hidden>·</span>
        <span>{t(`modes.${run.mode}`)}</span>
        <span aria-hidden>·</span>
        <span className="tabular">{f.marketDateTime(run.startedAt)}</span>
        <StatusBadge status={run.status} size="sm" />
      </span>
    ),
    [run.ticker, run.setup, run.mode, run.startedAt, run.status, t, f],
  );

  const actions = (
    <>
      {!readOnly && !wizardOn && !running && steps.some((s) => s.status !== 'done') && (
        <Button variant="outline" onClick={() => setWizardOn(true)}>
          <ListChecks aria-hidden />
          {t('wizard.toggle')}
        </Button>
      )}
      <Button variant="secondary" onClick={onStart} aria-expanded={starting}>
        <Plus aria-hidden />
        {t('start.newRun')}
      </Button>
      <HistoryMenu currentId={run.id} />
    </>
  );

  return (
    <div className="space-y-4">
      {header(actions, description)}
      {starting && <StartPanel onCancel={onCancelStart} onStarted={onCancelStart} />}
      {readOnly && <ReadOnlyBanner run={run} onLatest={onLatest} />}
      {stop && (run.mode === 'all' || stop.status !== 'check') && (
        <EarlyStopBanner
          run={run}
          stop={stop}
          readOnly={readOnly}
          busy={runStep.isPending}
          primary={!wizard && !starting}
          onRetry={() => {
            select(stop.key);
            // once the step passes, carry on one step at a time
            runSelected(stop.key, drafts[stop.key], (s) => {
              if (s.status === 'done') setWizardOn(true);
            });
          }}
          onStepByStep={!wizardOn ? () => setWizardOn(true) : undefined}
        />
      )}
      <StepGrid steps={steps} selected={selected} onSelect={select} />
      <StepDetail
        key={selected}
        run={run}
        step={step}
        editable={wizard}
        draft={draft}
        onDraft={(p) => setDrafts((d) => ({ ...d, [selected]: p }))}
      >
        {wizard && (
          <WizardBar
            step={step}
            run={run}
            busy={runStep.isPending}
            error={runStep.error}
            validation={validation}
            onBack={() => select(nextKey(selected, -1))}
            onNext={() => select(nextKey(selected, 1))}
            onRun={() => runSelected()}
          />
        )}
        {!wizard && runStep.error && <ErrorState error={runStep.error} compact className="mb-3" />}
      </StepDetail>
    </div>
  );
}
