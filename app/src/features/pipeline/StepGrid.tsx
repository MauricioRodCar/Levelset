import { ArrowRight, CornerDownRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Step, StepKey } from '@/api';
import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { STEP_ICONS, badgeFor, stepIndex } from './model';
import { useStepText } from './useStepText';

export interface StepGridProps {
  steps: Step[];
  selected: StepKey;
  onSelect: (key: StepKey) => void;
}

/** The eight steps in a 4 x 2 grid, connected by arrows (row 1 flows into row 2). */
export function StepGrid({ steps, selected, onSelect }: StepGridProps) {
  const { t } = useTranslation('pipeline');
  return (
    <ol
      aria-label={t('grid.label')}
      className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-x-6 gap-y-4 pl-5"
    >
      {steps.map((step, i) => (
        <li key={step.key} className="relative min-w-0">
          <StepCard step={step} selected={selected === step.key} onSelect={onSelect} />
          {i % 4 !== 3 && (
            <ArrowRight
              aria-hidden
              className="absolute -right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            />
          )}
          {i === 4 && (
            <CornerDownRight
              aria-hidden
              className="absolute -left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function StepCard({
  step,
  selected,
  onSelect,
}: {
  step: Step;
  selected: boolean;
  onSelect: (key: StepKey) => void;
}) {
  const { t } = useTranslation('pipeline');
  const text = useStepText();
  const Icon = STEP_ICONS[step.key];
  const n = stepIndex(step.key) + 1;
  const running = step.status === 'running';
  const checks = step.status === 'check' || step.status === 'blocked' ? (step.checks ?? []) : [];
  return (
    <button
      type="button"
      onClick={() => onSelect(step.key)}
      aria-pressed={selected}
      data-step={step.key}
      data-status={step.status}
      className={cn(
        'flex h-full w-full flex-col gap-1.5 rounded-lg border bg-surface p-3 text-left transition-colors focus-ring hover:bg-surface2',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border',
        running && 'border-info motion-safe:animate-pulse-soft',
        step.status === 'pending' && !selected && 'opacity-80',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="tabular flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface2 text-[11px] font-semibold text-text-muted">
          {n}
        </span>
        <Icon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        <span
          className="min-w-0 truncate text-sm font-semibold text-text"
          title={t(`steps.${step.key}`)}
        >
          {t(`steps.${step.key}`)}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <StatusBadge status={badgeFor(step)} size="sm" className="shrink-0" />
        {checks.length > 0 && (
          <span
            className={cn(
              'min-w-0 truncate rounded border px-1.5 py-0.5 text-[11px] text-text',
              step.status === 'blocked' ? 'border-loss/40' : 'border-warning/40',
            )}
            title={checks.map(text.check).join(' · ')}
          >
            {text.check(checks[0])}
            {checks.length > 1 ? ` +${checks.length - 1}` : ''}
          </span>
        )}
      </div>
      <p className="line-clamp-1 text-xs text-text-muted" title={text.inLine(step)}>
        <span className="font-medium">{t('card.in')}</span> {text.inLine(step)}
      </p>
      <p className="line-clamp-2 text-xs text-text" title={text.outLine(step)}>
        <span className="font-medium text-text-muted">{t('card.out')}</span> {text.outLine(step)}
      </p>
    </button>
  );
}
