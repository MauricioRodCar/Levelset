import { useId, useState, type FormEvent } from 'react';
import { CheckCircle2, FileDown, Loader2, Plus, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  fetchPaperExport,
  useActivatePaperAccount,
  useCreatePaperAccount,
  useResetPaperAccount,
  useSettings,
  type PaperAccount,
  type PaperRange,
} from '@/api';
import { ErrorState } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox, Input, Label, Select } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { useErrorMessage } from '@/components/useErrorMessage';
import { useSaveFile } from '@/components/useSaveFile';
import { useFormat } from '@/i18n/useFormat';
import { RANGE_PRESETS, type PaperSelection, type RangePreset } from './model';

export interface AccountBarProps {
  accounts: PaperAccount[];
  account: PaperAccount;
  selection: PaperSelection;
  onChange: (next: PaperSelection) => void;
  range: PaperRange;
}

/** Account switcher, period + date selectors, and the account actions (new, activate, reset, export). */
export function AccountBar({ accounts, account, selection, onChange, range }: AccountBarProps) {
  const { t } = useTranslation('paper');
  const f = useFormat();
  const uid = useId();
  const activate = useActivatePaperAccount();
  const errorMessage = useErrorMessage();
  const saveFile = useSaveFile();
  const [dialog, setDialog] = useState<null | 'create' | 'reset'>(null);
  const [exporting, setExporting] = useState(false);

  const periods = [...account.periods].reverse();

  const onExport = async () => {
    setExporting(true);
    try {
      const csv = await fetchPaperExport({ ...range, accountId: account.id, kind: 'all' });
      await saveFile(`levelset-paper-${account.id}.csv`, csv, 'CSV');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section
      aria-label={t('account.label')}
      className="rounded-lg border border-border bg-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 space-y-1">
          <Label htmlFor={`${uid}-acc`} className="text-xs text-text-muted">
            {t('account.label')}
          </Label>
          <Select
            id={`${uid}-acc`}
            value={account.id}
            onChange={(e) =>
              onChange({ ...selection, accountId: e.target.value, periodId: undefined })
            }
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.active ? t('account.optionActive', { name: a.name }) : a.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-56 space-y-1">
          <Label htmlFor={`${uid}-per`} className="text-xs text-text-muted">
            {t('account.period')}
          </Label>
          <Select
            id={`${uid}-per`}
            value={selection.periodId ?? account.currentPeriodId}
            onChange={(e) => onChange({ ...selection, periodId: e.target.value })}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {t(p.endedAt ? 'account.periodN' : 'account.periodCurrent', {
                  n: p.number,
                  date: f.marketDate(p.startedAt),
                })}
              </option>
            ))}
            <option value="all">{t('account.allPeriods')}</option>
          </Select>
        </div>
        <div className="min-w-40 space-y-1">
          <Label htmlFor={`${uid}-rng`} className="text-xs text-text-muted">
            {t('account.range')}
          </Label>
          <Select
            id={`${uid}-rng`}
            value={selection.preset}
            onChange={(e) => onChange({ ...selection, preset: e.target.value as RangePreset })}
          >
            {RANGE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {t(`account.ranges.${p}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {account.active ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-text-muted"
              title={t('account.activeHint')}
            >
              <CheckCircle2 className="h-4 w-4 text-profit" aria-hidden />
              {t('account.active')}
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={activate.isPending}
              onClick={() =>
                activate.mutate(account.id, {
                  onSuccess: (a) => toast(t('account.activated', { name: a.name })),
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              {t('account.makeActive')}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setDialog('create')}>
            <Plus aria-hidden />
            {t('account.new')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('reset')}>
            <RotateCcw aria-hidden />
            {t('account.reset')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void onExport()}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <FileDown aria-hidden />
            )}
            {t('account.export')}
          </Button>
        </div>
      </div>
      <p className="tabular mt-2 text-xs text-text-muted" data-testid="paper-account-summary">
        {t('account.equity', { value: f.money(account.equityUsd) })} ·{' '}
        {t('account.cash', { value: f.money(account.cashUsd) })} ·{' '}
        {t('account.open', { count: account.openPositions })}
      </p>

      <CreateAccountDialog
        open={dialog === 'create'}
        onOpenChange={(o) => setDialog(o ? 'create' : null)}
        nextNumber={accounts.length + 1}
        onCreated={(a) => onChange({ ...selection, accountId: a.id, periodId: undefined })}
      />
      <ResetAccountDialog
        account={account}
        open={dialog === 'reset'}
        onOpenChange={(o) => setDialog(o ? 'reset' : null)}
        onReset={() => onChange({ ...selection, periodId: undefined })}
      />
    </section>
  );
}

function useDefaultBalance() {
  const settings = useSettings();
  return settings.data?.account.accountSizeUsd ?? 5000;
}

function parseBalance(v: string): number | null {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function CreateAccountDialog({
  open,
  onOpenChange,
  nextNumber,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  nextNumber: number;
  onCreated: (a: PaperAccount) => void;
}) {
  const { t } = useTranslation('paper');
  const uid = useId();
  const create = useCreatePaperAccount();
  const defaultBalance = useDefaultBalance();
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [activate, setActivate] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = balance.trim() ? parseBalance(balance) : defaultBalance;
    setInvalid(amount == null);
    if (amount == null) return;
    try {
      const a = await create.mutateAsync({
        name: name.trim() || undefined,
        startingBalanceUsd: amount,
        activate,
      });
      toast(t('create.created', { name: a.name }));
      onCreated(a);
      onOpenChange(false);
      setName('');
      setBalance('');
    } catch {
      /* shown below */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
          <DialogDescription>{t('create.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-name`}>{t('create.name')}</Label>
            <Input
              id={`${uid}-name`}
              value={name}
              maxLength={60}
              placeholder={t('create.namePlaceholder', { n: nextNumber })}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-bal`}>{t('create.balance')}</Label>
            <Input
              id={`${uid}-bal`}
              type="number"
              inputMode="decimal"
              min={1}
              value={balance}
              placeholder={String(defaultBalance)}
              onChange={(e) => setBalance(e.target.value)}
              aria-invalid={invalid || undefined}
            />
            {invalid && <p className="text-xs text-text">{t('create.invalidBalance')}</p>}
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <Checkbox checked={activate} onCheckedChange={(v) => setActivate(v === true)} />
            {t('create.activate')}
          </label>
          {create.isError && <ErrorState compact error={create.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {t('create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetAccountDialog({
  account,
  open,
  onOpenChange,
  onReset,
}: {
  account: PaperAccount;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation('paper');
  const uid = useId();
  const reset = useResetPaperAccount();
  const defaultBalance = useDefaultBalance();
  const [balance, setBalance] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = balance.trim() ? parseBalance(balance) : defaultBalance;
    setInvalid(amount == null);
    if (amount == null) return;
    try {
      const a = await reset.mutateAsync({ accountId: account.id, startingBalanceUsd: amount });
      toast(t('reset.done', { name: a.name, n: a.periods[a.periods.length - 1].number }));
      onReset();
      onOpenChange(false);
      setBalance('');
    } catch {
      /* shown below */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('reset.title', { name: account.name })}</DialogTitle>
          <DialogDescription>{t('reset.body')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-bal`}>{t('reset.balance')}</Label>
            <Input
              id={`${uid}-bal`}
              type="number"
              inputMode="decimal"
              min={1}
              value={balance}
              placeholder={String(defaultBalance)}
              onChange={(e) => setBalance(e.target.value)}
              aria-invalid={invalid || undefined}
            />
            {invalid && <p className="text-xs text-text">{t('create.invalidBalance')}</p>}
          </div>
          {reset.isError && <ErrorState compact error={reset.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={reset.isPending}>
              {reset.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {t('reset.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
