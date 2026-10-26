import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateFill, type Ticket } from '@/api';
import { useErrorMessage } from '@/components/useErrorMessage';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { useFormat } from '@/i18n/useFormat';
import { priceForCopy } from '@/lib/format';

export interface RecordFillDialogProps {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Record a manual fill (POST /fills), prefilled from the ticket. Levelset never talks to a broker. */
export function RecordFillDialog({ ticket, open, onOpenChange }: RecordFillDialogProps) {
  const { t } = useTranslation('tickets');
  const { t: tc } = useTranslation('common');
  const f = useFormat();
  const errorMessage = useErrorMessage();
  const create = useCreateFill();
  const [side, setSide] = useState<Ticket['side']>(ticket.side);
  const [qty, setQty] = useState(String(ticket.qty));
  const [price, setPrice] = useState(priceForCopy(ticket.entry));
  const [touched, setTouched] = useState(false);
  const { reset } = create;

  useEffect(() => {
    if (!open) return;
    setSide(ticket.side);
    setQty(String(ticket.qty));
    setPrice(priceForCopy(ticket.entry));
    setTouched(false);
    reset();
  }, [open, ticket.side, ticket.qty, ticket.entry, reset]);

  const qtyNum = Number(qty);
  const priceNum = Number(price.replace(',', '.'));
  const qtyOk = Number.isInteger(qtyNum) && qtyNum >= 1;
  const priceOk = Number.isFinite(priceNum) && priceNum > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!qtyOk || !priceOk) return;
    try {
      await create.mutateAsync({
        symbol: ticket.symbol,
        side,
        qty: qtyNum,
        price: priceNum,
        ticketId: ticket.id,
      });
      toast(
        t('fill.recorded', {
          side: t(`side.${side}`),
          qty: qtyNum,
          symbol: ticket.symbol,
          price: f.price(priceNum),
        }),
      );
      onOpenChange(false);
    } catch {
      /* the error is shown in the form */
    }
  };

  const id = `fill-${ticket.id}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('fill.title', { symbol: ticket.symbol })}</DialogTitle>
          <DialogDescription>{t('fill.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor={`${id}-side`}>{t('fill.side')}</Label>
              <Select
                id={`${id}-side`}
                value={side}
                onChange={(e) => setSide(e.target.value as Ticket['side'])}
              >
                <option value="buy">{t('side.buy')}</option>
                <option value="sell">{t('side.sell')}</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-qty`}>{t('fill.qty')}</Label>
              <Input
                id={`${id}-qty`}
                type="number"
                min={1}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                aria-invalid={touched && !qtyOk}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-price`}>{t('fill.price')}</Label>
              <Input
                id={`${id}-price`}
                inputMode="decimal"
                className="tabular"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                aria-invalid={touched && !priceOk}
              />
            </div>
          </div>
          {touched && (!qtyOk || !priceOk) && (
            <p role="alert" className="text-xs text-text">
              {t('fill.invalid')}
            </p>
          )}
          {create.isError && (
            <p role="alert" className="text-xs text-text">
              {errorMessage(create.error)}
            </p>
          )}
          <p className="text-xs text-text-muted">{t('fill.noBroker')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {t('fill.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
