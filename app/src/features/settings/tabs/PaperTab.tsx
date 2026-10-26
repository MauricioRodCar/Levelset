import { useEffect, useId, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { usePaperSettings, useUpdatePaperSettings } from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import { Input, Label, Switch } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { useFormat } from '@/i18n/useFormat';

const toNum = (v: string) => Number(v.trim().replace(',', '.'));

/** Settings > Paper account: auto-follow and the slippage model (PATCH /paper/settings). */
export function PaperTab() {
  const { t } = useTranslation('settings');
  const f = useFormat();
  const uid = useId();
  const q = usePaperSettings();
  const save = useUpdatePaperSettings();
  const [pct, setPct] = useState('');
  const [perShare, setPerShare] = useState('');
  const [errors, setErrors] = useState<{ pct?: boolean; perShare?: boolean }>({});

  useEffect(() => {
    if (q.data) {
      setPct(String(q.data.slippagePct));
      setPerShare(String(q.data.slippagePerShare));
    }
  }, [q.data]);

  const onToggle = (autoFollow: boolean) =>
    save.mutate(
      { autoFollow },
      { onSuccess: () => toast(t(autoFollow ? 'paper.followOn' : 'paper.followOff')) },
    );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const p = toNum(pct);
    const s = toNum(perShare);
    const next = {
      pct: !(Number.isFinite(p) && p >= 0 && p <= 5),
      perShare: !(Number.isFinite(s) && s >= 0 && s <= 1),
    };
    setErrors(next);
    if (next.pct || next.perShare) return;
    try {
      await save.mutateAsync({ slippagePct: p, slippagePerShare: s });
      toast(t('paper.saved'));
    } catch {
      /* shown below */
    }
  };

  if (q.isLoading) return <Skeleton className="h-48 max-w-3xl" />;
  if (q.isError)
    return (
      <ErrorState title={t('paper.loadFailed')} error={q.error} onRetry={() => void q.refetch()} />
    );
  const s = q.data!;
  const example =
    364.21 * (1 + (Number.isFinite(toNum(pct)) ? toNum(pct) : 0) / 100) +
    (Number.isFinite(toNum(perShare)) ? toNum(perShare) : 0);

  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
      <Card title={t('paper.follow.title')} subtitle={t('paper.follow.subtitle')}>
        <label className="flex items-start gap-3">
          <Switch
            checked={s.autoFollow}
            onCheckedChange={onToggle}
            disabled={save.isPending}
            aria-describedby={`${uid}-follow`}
            className="mt-0.5"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium text-text">{t('paper.follow.label')}</span>
            <span id={`${uid}-follow`} className="block text-xs text-text-muted">
              {t('paper.follow.hint')}
            </span>
          </span>
        </label>
        <p className="mt-3 text-xs text-text-muted">
          {t('paper.follow.separate')}{' '}
          <Link to="/paper" className="text-accent hover:underline focus-ring">
            {t('paper.open')}
          </Link>
        </p>
      </Card>

      <Card title={t('paper.slippage.title')} subtitle={t('paper.slippage.subtitle')}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-pct`}>{t('paper.slippage.pct')}</Label>
              <Input
                id={`${uid}-pct`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                max={5}
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                aria-invalid={errors.pct || undefined}
              />
              <p className="text-xs text-text-muted">
                {errors.pct ? t('paper.slippage.pctError') : t('paper.slippage.pctHint')}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-ps`}>{t('paper.slippage.perShare')}</Label>
              <Input
                id={`${uid}-ps`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                max={1}
                value={perShare}
                onChange={(e) => setPerShare(e.target.value)}
                aria-invalid={errors.perShare || undefined}
              />
              <p className="text-xs text-text-muted">
                {errors.perShare
                  ? t('paper.slippage.perShareError')
                  : t('paper.slippage.perShareHint')}
              </p>
            </div>
          </div>
          <p className="tabular rounded-md border border-border bg-surface2 px-3 py-2 text-xs text-text-muted">
            {t('paper.slippage.example', { open: f.price(364.21), fill: f.price(example) })}
          </p>
          {save.isError && <ErrorState compact title={t('paper.saveFailed')} error={save.error} />}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {t('paper.save')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
