import { useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAiExplain, useAiStatus, type AiExplainRequest } from '@/api';
import { ErrorState } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AiAnswerView } from './AiAnswerView';
import { useAiLang } from './lang';

export type AiExplainButtonProps = Omit<AiExplainRequest, 'lang'> & { className?: string };

/**
 * Contextual "Explain" button (Layer 1). Renders nothing while AI is off, so every page works
 * without it; disabled with the reason when there is no key or the monthly cap is reached.
 * The answer opens inline below the button.
 */
export function AiExplainButton({ className, ...req }: AiExplainButtonProps) {
  const { t } = useTranslation('ai');
  const lang = useAiLang();
  const status = useAiStatus();
  const explain = useAiExplain();
  const [shown, setShown] = useState(false);
  const s = status.data;
  if (!s?.enabled) return null;

  const run = () => {
    setShown(true);
    explain.mutate({ ...req, lang });
  };
  const label = t(`explain.${req.kind}`);
  const reason = s.ready ? null : s.reason;

  return (
    <div className={cn('space-y-2', className)} data-testid={`ai-explain-${req.kind}`}>
      <div className="flex items-center gap-2">
        {reason ? (
          <SimpleTooltip label={t(`notReady.${reason}`)}>
            <span tabIndex={0} className="inline-flex">
              <Button size="sm" variant="outline" disabled>
                <Sparkles aria-hidden />
                {label}
              </Button>
            </span>
          </SimpleTooltip>
        ) : (
          <Button size="sm" variant="outline" onClick={run} disabled={explain.isPending}>
            {explain.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Sparkles className="text-accent" aria-hidden />
            )}
            {explain.isPending ? t('explain.loading') : shown ? t('explain.again') : label}
          </Button>
        )}
        {shown && !explain.isPending && (
          <Button size="sm" variant="ghost" onClick={() => setShown(false)}>
            <X aria-hidden />
            {t('explain.hide')}
          </Button>
        )}
      </div>
      {reason && (
        <p className="text-xs text-text-muted">
          {t(`notReady.${reason}`)}{' '}
          <Link to="/settings/ai" className="text-accent underline-offset-4 hover:underline">
            {t('notReady.openSettings')}
          </Link>
        </p>
      )}
      {shown && (explain.data || explain.error) && (
        <section
          aria-label={t('explain.regionLabel')}
          className="rounded-md border border-border bg-surface2 px-3 py-2.5"
        >
          {explain.error ? (
            <ErrorState compact error={explain.error} onRetry={run} />
          ) : (
            explain.data && <AiAnswerView answer={explain.data} />
          )}
        </section>
      )}
    </div>
  );
}
