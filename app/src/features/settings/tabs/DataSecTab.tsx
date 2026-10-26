import { useEffect, useId, useState, type FormEvent } from 'react';
import { Clock, FlaskConical, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettings, useStatus, useUpdateSettings } from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { validateSecUserAgent, type SecUserAgentError } from './validation';

/** Settings > Data & SEC: SEC EDGAR identity, demo mode (read-only) and the data-delay notice. */
export function DataSecTab() {
  const { t } = useTranslation('settings');
  const uid = useId();
  const settings = useSettings();
  const status = useStatus();
  const save = useUpdateSettings();
  const [ua, setUa] = useState('');
  const [error, setError] = useState<SecUserAgentError | null>(null);

  useEffect(() => {
    if (settings.data) setUa(settings.data.data.secUserAgent ?? '');
  }, [settings.data]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const err = validateSecUserAgent(ua);
    setError(err);
    if (err || !settings.data) return;
    try {
      await save.mutateAsync({
        ...settings.data,
        data: { ...settings.data.data, secUserAgent: ua.trim() },
      });
      toast(t('data.saved'));
    } catch {
      /* shown below */
    }
  };

  const demo = settings.data?.data.demoMode ?? status.data?.mode === 'demo';
  const delayMin = Math.round((status.data?.dataDelaySeconds ?? 900) / 60);
  const fieldId = `${uid}-ua`;

  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
      <Card title={t('data.sec.title')} subtitle={t('data.sec.subtitle')} className="lg:row-span-2">
        {settings.isLoading ? (
          <Skeleton className="h-24" />
        ) : settings.isError ? (
          <ErrorState
            compact
            title={t('account.loadFailed')}
            error={settings.error}
            onRetry={() => void settings.refetch()}
          />
        ) : (
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={fieldId}>{t('data.sec.field')}</Label>
              <Input
                id={fieldId}
                value={ua}
                placeholder={t('data.sec.placeholder')}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setUa(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${fieldId}-err` : `${fieldId}-hint`}
              />
              {error ? (
                <p id={`${fieldId}-err`} className="text-xs text-text">
                  <span
                    aria-hidden
                    className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-loss align-middle"
                  />
                  {t(`data.sec.errors.${error}`)}
                </p>
              ) : (
                <p id={`${fieldId}-hint`} className="text-xs text-text-muted">
                  {t('data.sec.hint')}
                </p>
              )}
            </div>
            <div className="space-y-2 rounded-md border border-border bg-surface2 px-3 py-2.5 text-xs text-text-muted">
              <p className="font-medium text-text">{t('data.sec.whyTitle')}</p>
              <p>{t('data.sec.why')}</p>
              <p>{t('data.sec.privacy')}</p>
            </div>
            {save.isError && <ErrorState compact title={t('data.saveFailed')} error={save.error} />}
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
                {t('data.save')}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card title={t('data.demo.title')}>
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-text" data-testid="demo-mode-value">
              {demo ? t('data.demo.on') : t('data.demo.off')}
            </p>
            <p className="text-xs text-text-muted">{t('data.demo.explain')}</p>
          </div>
        </div>
      </Card>

      <Card title={t('data.delay.title')}>
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-text">{t('data.delay.value', { count: delayMin })}</p>
            <p className="text-xs text-text-muted">{t('data.delay.explain')}</p>
            <p className="text-xs text-text-muted">{t('data.delay.sources')}</p>
            <p className="text-xs text-text-muted">{t('data.delay.pro')}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
