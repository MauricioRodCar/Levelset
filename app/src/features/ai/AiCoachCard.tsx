import { useEffect, useId, useState } from 'react';
import { GraduationCap, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAiCoach, useAiStatus, useStatus } from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { AiAnswerView } from './AiAnswerView';
import { useAiLang } from './lang';

/**
 * Layer 2 coach review for the Paper account page: paper (every signal followed) vs. manual
 * fills over a date range. Renders nothing while AI is off. Default range: this month so far.
 */
export function AiCoachCard({ accountId, className }: { accountId?: string; className?: string }) {
  const { t } = useTranslation('ai');
  const uid = useId();
  const lang = useAiLang();
  const ai = useAiStatus();
  const status = useStatus();
  const coach = useAiCoach();
  const today = status.data?.nowEt.slice(0, 10) ?? '';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    if (!today) return;
    setFrom((v) => v || `${today.slice(0, 8)}01`);
    setTo((v) => v || today);
  }, [today]);

  if (!ai.data?.enabled) return null;
  const s = ai.data;
  const run = () => coach.mutate({ from, to, lang, ...(accountId ? { accountId } : {}) });

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <GraduationCap className="h-4 w-4 text-accent" aria-hidden />
          {t('coach.title')}
        </span>
      }
      subtitle={t('coach.subtitle')}
      className={className}
      data-testid="ai-coach"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor={`${uid}-from`}>{t('coach.from')}</Label>
            <Input
              id={`${uid}-from`}
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${uid}-to`}>{t('coach.to')}</Label>
            <Input
              id={`${uid}-to`}
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            onClick={run}
            disabled={!s.ready || coach.isPending || !from || !to || from > to}
          >
            {coach.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <GraduationCap aria-hidden />}
            {coach.isPending ? t('coach.running') : t('coach.run')}
          </Button>
        </div>
        {!s.ready && s.reason && <p className="text-xs text-text-muted">{t(`notReady.${s.reason}`)}</p>}
        {coach.error && <ErrorState compact error={coach.error} onRetry={run} />}
        {coach.data && !coach.isPending && <AiAnswerView answer={coach.data} />}
      </div>
    </Card>
  );
}
