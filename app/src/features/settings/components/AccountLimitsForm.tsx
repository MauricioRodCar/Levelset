import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettings, useUpdateSettings, type Settings } from '@/api';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import { Input, Label, Switch } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { DEFAULT_SETTINGS, validateLimits, type LimitsErrors } from './accountLimits';

function Field({
  label,
  hint,
  error,
  children,
  id,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="text-xs text-text">
          <span
            aria-hidden
            className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-loss align-middle"
          />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export interface AccountLimitsFormProps {
  /** Called after a successful PUT /settings. */
  onSaved?: (s: Settings) => void;
  submitLabel?: string;
  /** Extra buttons rendered next to submit (e.g. onboarding Back / Skip). */
  extraActions?: ReactNode;
  className?: string;
}

/**
 * Account & limits form (GET /settings -> PUT /settings). Reused by onboarding and Settings.
 * Keeps unknown fields (data block, other limits) intact when saving.
 */
export function AccountLimitsForm({
  onSaved,
  submitLabel,
  extraActions,
  className,
}: AccountLimitsFormProps) {
  const { t } = useTranslation('settings');
  const uid = useId();
  const query = useSettings();
  const save = useUpdateSettings();
  const [draft, setDraft] = useState<Settings>(DEFAULT_SETTINGS);
  const [errors, setErrors] = useState<LimitsErrors>({});

  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);

  const setAccount = (patch: Partial<Settings['account']>) =>
    setDraft((d) => ({ ...d, account: { ...d.account, ...patch } }));
  const setLimits = (patch: Partial<Settings['limits']>) =>
    setDraft((d) => ({ ...d, limits: { ...d.limits, ...patch } }));
  const num = (v: string) => (v === '' ? NaN : Number(v));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateLimits(draft);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const saved = await save.mutateAsync(draft);
      toast(t('account.saved'));
      onSaved?.(saved);
    } catch {
      /* shown below */
    }
  };

  if (query.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  }

  const id = (k: string) => `${uid}-${k}`;
  const err = (k: keyof LimitsErrors) => (errors[k] ? t(`account.errors.${errors[k]}`) : undefined);
  const aria = (k: keyof LimitsErrors) => ({
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? `${id(k)}-err` : `${id(k)}-hint`,
  });

  return (
    <form onSubmit={onSubmit} noValidate className={cn('space-y-5', className)}>
      {query.isError && (
        <ErrorState
          compact
          title={t('account.loadFailed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={id('accountSizeUsd')}
          label={t('account.fields.accountSize')}
          hint={t('account.hints.accountSize')}
          error={err('accountSizeUsd')}
        >
          <Input
            id={id('accountSizeUsd')}
            type="number"
            inputMode="decimal"
            min={0}
            step={100}
            value={Number.isNaN(draft.account.accountSizeUsd) ? '' : draft.account.accountSizeUsd}
            onChange={(e) => setAccount({ accountSizeUsd: num(e.target.value) })}
            {...aria('accountSizeUsd')}
          />
        </Field>
        <Field
          id={id('maxLossPerTradeUsd')}
          label={t('account.fields.maxLossPerTrade')}
          hint={t('account.hints.maxLossPerTrade')}
          error={err('maxLossPerTradeUsd')}
        >
          <Input
            id={id('maxLossPerTradeUsd')}
            type="number"
            inputMode="decimal"
            min={0}
            step={5}
            value={draft.limits.maxLossPerTradeUsd ?? ''}
            onChange={(e) => setLimits({ maxLossPerTradeUsd: num(e.target.value) })}
            {...aria('maxLossPerTradeUsd')}
          />
        </Field>
        <Field
          id={id('maxDailyLossUsd')}
          label={t('account.fields.maxDailyLoss')}
          hint={t('account.hints.maxDailyLoss')}
          error={err('maxDailyLossUsd')}
        >
          <Input
            id={id('maxDailyLossUsd')}
            type="number"
            inputMode="decimal"
            min={0}
            step={5}
            value={draft.limits.maxDailyLossUsd ?? ''}
            onChange={(e) => setLimits({ maxDailyLossUsd: num(e.target.value) })}
            {...aria('maxDailyLossUsd')}
          />
        </Field>
        <Field
          id={id('maxTradesPerDay')}
          label={t('account.fields.maxTradesPerDay')}
          hint={t('account.hints.maxTradesPerDay')}
          error={err('maxTradesPerDay')}
        >
          <Input
            id={id('maxTradesPerDay')}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={draft.limits.maxTradesPerDay ?? ''}
            onChange={(e) => setLimits({ maxTradesPerDay: num(e.target.value) })}
            {...aria('maxTradesPerDay')}
          />
        </Field>
        <Field
          id={id('minRewardRisk')}
          label={t('account.fields.minRewardRisk')}
          hint={t('account.hints.minRewardRisk')}
          error={err('minRewardRisk')}
        >
          <Input
            id={id('minRewardRisk')}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.1}
            value={draft.limits.minRewardRisk ?? ''}
            onChange={(e) => setLimits({ minRewardRisk: num(e.target.value) })}
            {...aria('minRewardRisk')}
          />
        </Field>
        <Field
          id={id('cashBufferPct')}
          label={t('account.fields.cashBuffer')}
          hint={t('account.hints.cashBuffer')}
          error={err('cashBufferPct')}
        >
          <Input
            id={id('cashBufferPct')}
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={1}
            value={draft.account.cashBufferPct ?? ''}
            onChange={(e) => setAccount({ cashBufferPct: num(e.target.value) })}
            {...aria('cashBufferPct')}
          />
        </Field>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-medium text-text">{t('account.window.title')}</legend>
        <Field
          id={id('noEntriesBefore')}
          label={t('account.fields.noEntriesBefore')}
          error={err('noEntriesBefore')}
        >
          <Input
            id={id('noEntriesBefore')}
            type="time"
            value={draft.limits.noEntriesBefore ?? ''}
            onChange={(e) => setLimits({ noEntriesBefore: e.target.value })}
            {...aria('noEntriesBefore')}
          />
        </Field>
        <Field
          id={id('noEntriesAfter')}
          label={t('account.fields.noEntriesAfter')}
          error={err('noEntriesAfter')}
        >
          <Input
            id={id('noEntriesAfter')}
            type="time"
            value={draft.limits.noEntriesAfter ?? ''}
            onChange={(e) => setLimits({ noEntriesAfter: e.target.value })}
            {...aria('noEntriesAfter')}
          />
        </Field>
        <Field id={id('flatBy')} label={t('account.fields.flatBy')} error={err('flatBy')}>
          <Input
            id={id('flatBy')}
            type="time"
            value={draft.limits.flatBy ?? ''}
            onChange={(e) => setLimits({ flatBy: e.target.value })}
            {...aria('flatBy')}
          />
        </Field>
        <p className="text-xs text-text-muted sm:col-span-3">{t('account.window.hint')}</p>
      </fieldset>

      <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface2 px-3 py-2.5">
        <div>
          <Label htmlFor={id('pdtGuard')}>{t('account.fields.pdtGuard')}</Label>
          <p className="text-xs text-text-muted">{t('account.hints.pdtGuard')}</p>
        </div>
        <Switch
          id={id('pdtGuard')}
          checked={!!draft.limits.pdtGuard}
          onCheckedChange={(v) => setLimits({ pdtGuard: v })}
        />
      </div>

      {save.isError && <ErrorState compact title={t('account.saveFailed')} error={save.error} />}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {extraActions}
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {submitLabel ?? t('account.save')}
        </Button>
      </div>
    </form>
  );
}
