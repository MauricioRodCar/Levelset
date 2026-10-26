import { Fragment, type ReactNode } from 'react';
import { Database, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { AiAnswer, AiCitation } from '@/api';
import { intlLocale } from '@/lib/format';
import { cn } from '@/lib/utils';
import { disclaimerI18nKey } from './lang';

/** **bold** inside a line. Plain React nodes only (never HTML injection). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Light Markdown the engine promises (paragraphs, "- " bullet lists, **bold**). */
export function AiText({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed text-text', className)}>
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l)))
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function citationHref(c: AiCitation): string | null {
  if (!c.ref) return null;
  if (c.ref.kind === 'run') return `/pipeline/${encodeURIComponent(c.ref.id)}`;
  if (c.ref.kind === 'paper_account') return '/paper';
  if (c.ref.kind === 'settings') return '/settings/account';
  if (c.ref.kind === 'analyst') return `/analyst?symbol=${encodeURIComponent(c.ref.id)}`;
  return null;
}

/** Answer body + data used (citations) + tokens and cost + the not-financial-advice footer. */
export function AiAnswerView({ answer, compact }: { answer: AiAnswer; compact?: boolean }) {
  const { t, i18n } = useTranslation('ai');
  const loc = intlLocale(i18n.language);
  const n = new Intl.NumberFormat(loc);
  const cost = new Intl.NumberFormat(loc, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(answer.usage.costUsd);

  return (
    <div className="space-y-2" data-testid="ai-answer">
      <AiText text={answer.text} />
      <div className="space-y-1 border-t border-border pt-2 text-xs text-text-muted">
        {answer.citations.length ? (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="ai-citations">
            <span className="inline-flex items-center gap-1">
              <Database className="h-3 w-3" aria-hidden />
              {t('answer.sources')}:
            </span>
            {answer.citations.map((c, i) => {
              const href = citationHref(c);
              const cls = 'rounded border border-border bg-surface2 px-1.5 py-0.5 text-text';
              return href ? (
                <Link key={i} to={href} className={cn(cls, 'focus-ring hover:border-primary')}>
                  {c.label}
                </Link>
              ) : (
                <span key={i} className={cls}>
                  {c.label}
                </span>
              );
            })}
          </div>
        ) : (
          <p>{t('answer.noSources')}</p>
        )}
        <p className="tabular" aria-label={t('answer.usageLabel')} data-testid="ai-usage">
          {t('answer.usage', {
            input: n.format(answer.usage.inputTokens),
            output: n.format(answer.usage.outputTokens),
            cost,
          })}
          {!compact && <> · {t('answer.model', { model: answer.model })}</>}
        </p>
        <p className="flex items-start gap-1" data-testid="ai-disclaimer">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {t(disclaimerI18nKey(answer.disclaimerKey))}
        </p>
      </div>
    </div>
  );
}
