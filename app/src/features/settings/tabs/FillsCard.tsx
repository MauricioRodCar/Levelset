import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDeleteFill, useFills, useStatus, type Fill } from '@/api';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
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
import { toast } from '@/components/ui/toaster';
import { useApiErrorText } from '@/features/alerts/useApiErrorText';
import { useFormat } from '@/i18n/useFormat';
import { MARKET_TZ } from '@/lib/format';

const nyDay = (v: string | Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: MARKET_TZ }).format(new Date(v));

/** Today's manual fills (New York day) with a guarded delete for a wrong entry. */
export function FillsCard() {
  const { t } = useTranslation('settings');
  const f = useFormat();
  const fills = useFills();
  const status = useStatus();
  const remove = useDeleteFill();
  const errorText = useApiErrorText();
  const [confirm, setConfirm] = useState<Fill | null>(null);

  const today = useMemo(() => {
    const day = nyDay(status.data?.nowEt ?? new Date());
    return (fills.data ?? []).filter((x) => x.at && nyDay(x.at) === day);
  }, [fills.data, status.data?.nowEt]);

  const doDelete = async () => {
    if (!confirm) return;
    try {
      await remove.mutateAsync(confirm.id);
      toast(t('fills.deleted'));
      setConfirm(null);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const side = (x: Fill) => t(`fills.side.${x.side}`);

  return (
    <Card title={t('fills.title')} subtitle={t('fills.subtitle')} flush>
      {fills.isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : fills.isError ? (
        <div className="p-4">
          <ErrorState compact error={fills.error} onRetry={() => void fills.refetch()} />
        </div>
      ) : today.length === 0 ? (
        <EmptyState title={t('fills.empty')} description={t('fills.emptyHint')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border text-left text-xs text-text-muted">
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('fills.time')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('fills.ticker')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('fills.sideLabel')}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t('fills.qty')}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t('fills.price')}
                </th>
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">{t('fills.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {today.map((x) => (
                <tr key={x.id} className="border-b border-border last:border-b-0">
                  <td className="tabular px-4 py-2 text-text-muted">
                    {x.at ? f.marketTime(x.at) : '—'}
                  </td>
                  <td className="px-3 py-2 font-semibold text-text">{x.symbol}</td>
                  <td className="px-3 py-2 text-text">{side(x)}</td>
                  <td className="tabular px-3 py-2 text-right text-text">{x.qty}</td>
                  <td className="tabular px-3 py-2 text-right text-text">{f.price(x.price)}</td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('fills.deleteLabel', {
                        side: side(x),
                        qty: x.qty,
                        symbol: x.symbol,
                      })}
                      onClick={() => setConfirm(x)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('fills.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {confirm &&
                t('fills.confirmBody', {
                  side: side(confirm),
                  qty: confirm.qty,
                  symbol: confirm.symbol,
                  price: f.price(confirm.price),
                })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button variant="danger" disabled={remove.isPending} onClick={() => void doDelete()}>
              <Trash2 aria-hidden />
              {t('fills.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
