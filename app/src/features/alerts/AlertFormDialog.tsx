import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCreateAlert, useUpdateAlert, type Alert, type AlertUpdate } from '@/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox, Input, Label, Select } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { ApiErrorNote } from './ApiErrorNote';
import {
  ALERT_TYPES,
  EMPTY_DRAFT,
  alertFields,
  draftFromAlert,
  draftToCreate,
  draftToPatch,
  validateAlertDraft,
  type AlertDraft,
  type AlertErrors,
} from './model';

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
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

export interface AlertFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this alert; create a new one when absent. */
  alert?: Alert | null;
}

/** Custom alert form for every AlertCreate type (create = POST, edit = PATCH). */
export function AlertFormDialog({ open, onOpenChange, alert }: AlertFormDialogProps) {
  const { t } = useTranslation('alerts');
  const uid = useId();
  const create = useCreateAlert();
  const update = useUpdateAlert();
  const [draft, setDraft] = useState<AlertDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<AlertErrors>({});
  const [rearm, setRearm] = useState(true);
  const editing = !!alert;
  const mutation = editing ? update : create;

  useEffect(() => {
    if (!open) return;
    setDraft(alert ? draftFromAlert(alert) : EMPTY_DRAFT);
    setErrors({});
    setRearm(true);
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, alert]);

  const fields = alertFields(draft.type);
  const set = (patch: Partial<AlertDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const id = (k: string) => `${uid}-${k}`;
  const err = (k: keyof AlertErrors) => (errors[k] ? t(`form.errors.${errors[k]}`) : undefined);
  const aria = (k: keyof AlertErrors) => ({
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? `${id(k)}-err` : `${id(k)}-hint`,
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateAlertDraft(draft);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      if (alert) {
        const patch = draftToPatch(draft) as AlertUpdate;
        if (alert.status === 'rung' && rearm) patch.status = 'armed';
        await update.mutateAsync({ alertId: alert.id, patch });
        toast(t('toast.updated'));
      } else {
        await create.mutateAsync(draftToCreate(draft));
        toast(t('toast.created'));
      }
      onOpenChange(false);
    } catch {
      /* shown below */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? t('form.editTitle') : t('form.createTitle')}</DialogTitle>
            <DialogDescription>{t('form.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field id={id('type')} label={t('form.type')} hint={t(`form.typeHints.${draft.type}`)}>
              <Select
                id={id('type')}
                value={draft.type}
                onChange={(e) => {
                  set({ type: e.target.value as AlertDraft['type'] });
                  setErrors({});
                }}
                aria-describedby={`${id('type')}-hint`}
              >
                {ALERT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </Select>
            </Field>

            {fields.symbol !== 'none' && (
              <Field
                id={id('symbol')}
                label={fields.symbol === 'optional' ? t('form.symbolOptional') : t('form.symbol')}
                hint={t('form.symbolHint')}
                error={err('symbol')}
              >
                <Input
                  id={id('symbol')}
                  value={draft.symbol}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={8}
                  className="uppercase"
                  onChange={(e) => set({ symbol: e.target.value })}
                  {...aria('symbol')}
                />
              </Field>
            )}

            {fields.level && (
              <Field
                id={id('level')}
                label={t('form.level')}
                hint={t('form.levelHint')}
                error={err('level')}
              >
                <Input
                  id={id('level')}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  value={draft.level}
                  onChange={(e) => set({ level: e.target.value })}
                  {...aria('level')}
                />
              </Field>
            )}

            {fields.pct && (
              <Field
                id={id('pct')}
                label={t('form.pct')}
                hint={t('form.pctHint')}
                error={err('pct')}
              >
                <Input
                  id={id('pct')}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.1}
                  value={draft.pct}
                  onChange={(e) => set({ pct: e.target.value })}
                  {...aria('pct')}
                />
              </Field>
            )}

            {fields.time !== 'none' && (
              <Field
                id={id('time')}
                label={fields.time === 'optional' ? t('form.timeOptional') : t('form.time')}
                hint={fields.time === 'optional' ? t('form.flatByHint') : t('form.timeHint')}
                error={err('time')}
              >
                <Input
                  id={id('time')}
                  type="time"
                  value={draft.time}
                  onChange={(e) => set({ time: e.target.value })}
                  {...aria('time')}
                />
              </Field>
            )}

            <Field id={id('note')} label={t('form.note')} error={err('note')}>
              <Input
                id={id('note')}
                value={draft.note}
                maxLength={140}
                onChange={(e) => set({ note: e.target.value })}
                {...aria('note')}
              />
            </Field>

            {alert?.status === 'rung' && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={id('rearm')}
                  checked={rearm}
                  onCheckedChange={(v) => setRearm(v === true)}
                />
                <Label htmlFor={id('rearm')}>{t('form.rearmOnSave')}</Label>
              </div>
            )}

            {mutation.isError && <ApiErrorNote error={mutation.error} />}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {editing ? t('common:actions.save') : t('form.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
