import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces } from 'lucide-react';
import type { PipelineRun, Step } from '@/api';
import { Card } from '@/components/Card';
import { StatusBadge } from '@/components/StatusBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiExplainButton } from '@/features/ai';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';
import { BudgetDetail, RiskDetail, TicketDetail } from './details/BudgetRiskTicket';
import { KeyValues } from './details/common';
import { EntryDetail, ExitDetail } from './details/EntryExit';
import { NewsDetail, ScannerDetail } from './details/ScannerNews';
import { TimeMachineDetail } from './details/TimeMachine';
import { STEP_ICONS, badgeFor, stepIndex } from './model';
import { ParamsForm, type Params } from './ParamsForm';
import { useStepText } from './useStepText';

export interface StepDetailProps {
  run: PipelineRun;
  step: Step;
  /** Parameters can be edited (wizard on an editable run). */
  editable: boolean;
  draft: Params;
  onDraft: (p: Params) => void;
  /** Extra content under the header (wizard explain text / controls). */
  children?: ReactNode;
}

export function StepDetail({ run, step, editable, draft, onDraft, children }: StepDetailProps) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const text = useStepText();
  const [raw, setRaw] = useState(false);
  const [tab, setTab] = useState<string>(
    editable && step.status === 'pending' ? 'params' : 'outputs',
  );
  const Icon = STEP_ICONS[step.key];
  const finished = step.status !== 'pending' && step.status !== 'running';

  return (
    <Card
      as="section"
      aria-label={t('detail.label', { step: t(`steps.${step.key}`) })}
      data-testid="step-detail"
      title={
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-text-muted" aria-hidden />
          <span>
            {stepIndex(step.key) + 1}. {t(`steps.${step.key}`)}
          </span>
          <StatusBadge status={badgeFor(step)} size="sm" />
        </span>
      }
      subtitle={
        step.startedAt
          ? t('detail.times', {
              start: f.marketTime(step.startedAt, { seconds: true }),
              end: step.endedAt ? f.marketTime(step.endedAt, { seconds: true }) : '…',
            })
          : t(`stepInfo.${step.key}.what`)
      }
    >
      {children}
      {finished && (
        <AiExplainButton kind="pipeline_step" runId={run.id} stepKey={step.key} className="mb-3" />
      )}
      {(step.checks?.length ?? 0) > 0 && (
        <ul className="mb-3 flex flex-wrap gap-1.5" aria-label={t('detail.checks')}>
          {step.checks!.map((c) => (
            <li
              key={c}
              className={cn(
                'rounded-md border px-2 py-0.5 text-xs text-text',
                step.status === 'blocked' || step.status === 'error'
                  ? 'border-loss/50 bg-loss/5'
                  : 'border-warning/50 bg-warning/5',
              )}
            >
              {text.check(c)}
            </li>
          ))}
        </ul>
      )}
      {step.status === 'error' && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-loss/40 bg-loss/5 px-3 py-2 text-sm text-text"
        >
          {t('detail.error')}{' '}
          <span className="text-text-muted" lang="en">
            {step.error ?? step.summary?.outLine}
          </span>
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="inputs">{t('detail.tabs.inputs')}</TabsTrigger>
            <TabsTrigger value="outputs">{t('detail.tabs.outputs')}</TabsTrigger>
            <TabsTrigger value="params">{t('detail.tabs.params')}</TabsTrigger>
          </TabsList>
          {tab === 'outputs' && finished && (
            <button
              type="button"
              aria-pressed={raw}
              onClick={() => setRaw((x) => !x)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs focus-ring',
                raw
                  ? 'border-primary bg-primary/10 text-text'
                  : 'border-border text-text-muted hover:text-text',
              )}
            >
              <Braces className="h-3.5 w-3.5" aria-hidden />
              {t('detail.rawJson')}
            </button>
          )}
        </div>
        <TabsContent value="inputs">
          <KeyValues data={step.inputs ?? {}} empty={t('detail.noInputs')} />
        </TabsContent>
        <TabsContent value="outputs">
          {!finished ? (
            <p className="text-sm text-text-muted">
              {step.status === 'running' ? t('detail.running') : t('detail.notRun')}
            </p>
          ) : raw ? (
            <pre
              data-testid="raw-json"
              className="max-h-96 overflow-auto rounded-md border border-border bg-bg p-3 font-mono text-xs text-text"
            >
              {JSON.stringify(step.outputs ?? {}, null, 2)}
            </pre>
          ) : (
            <Outputs run={run} step={step} />
          )}
        </TabsContent>
        <TabsContent value="params">
          <ParamsForm
            stepKey={step.key}
            value={editable ? draft : (step.params ?? {})}
            onChange={onDraft}
            editable={editable}
            setup={run.setup ?? 'orb'}
          />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function Outputs({ run, step }: { run: PipelineRun; step: Step }) {
  switch (step.key) {
    case 'scanner':
      return <ScannerDetail step={step} run={run} />;
    case 'news':
      return <NewsDetail step={step} />;
    case 'entry':
      return <EntryDetail step={step} run={run} />;
    case 'exit':
      return <ExitDetail step={step} run={run} />;
    case 'timemachine':
      return <TimeMachineDetail step={step} />;
    case 'budget':
      return <BudgetDetail step={step} />;
    case 'risk':
      return <RiskDetail step={step} />;
    case 'ticket':
      return <TicketDetail step={step} run={run} />;
  }
}
