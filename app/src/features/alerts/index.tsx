import { useMemo, useState } from 'react';
import { BellPlus, ListPlus, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAlerts, useDeleteAlert, useUpdateAlert, type Alert } from '@/api';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge } from '@/components/StatusBadge';
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
import { useFormat } from '@/i18n/useFormat';
import { AlertFormDialog } from './AlertFormDialog';
import { useApiErrorText } from './useApiErrorText';
import { FromPlanDialog } from './FromPlanDialog';
import { NotificationSettings } from './NotificationSettings';
import { alertTrigger } from './model';

/** S3 Alerts: alert table (armed / rung), add from plan, custom alerts, edit / re-arm / delete. */
export default function AlertsPage() {
  const { t } = useTranslation('alerts');
  const f = useFormat();
  const alerts = useAlerts();
  const remove = useDeleteAlert();
  const update = useUpdateAlert();
  const errorText = useApiErrorText();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Alert | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [confirm, setConfirm] = useState<Alert | null>(null);

  // armed first, then the most recently rung / created
  const rows = useMemo(
    () =>
      [...(alerts.data ?? [])].sort((a, b) => {
        if (a.status !== b.status) return a.status === 'armed' ? -1 : 1;
        return (b.rungAt ?? b.createdAt).localeCompare(a.rungAt ?? a.createdAt);
      }),
    [alerts.data],
  );
  const armed = rows.filter((a) => a.status === 'armed').length;

  const rearm = async (a: Alert) => {
    try {
      await update.mutateAsync({ alertId: a.id, patch: { status: 'armed' } });
      toast(t('toast.rearmed'));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const doDelete = async () => {
    if (!confirm) return;
    try {
      await remove.mutateAsync(confirm.id);
      toast(t('toast.deleted'));
      setConfirm(null);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Button onClick={openCreate}>
              <BellPlus aria-hidden />
              {t('actions.custom')}
            </Button>
            <Button variant="primary" onClick={() => setPlanOpen(true)}>
              <ListPlus aria-hidden />
              {t('actions.fromPlan')}
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card
          flush
          title={t('table.title')}
          subtitle={alerts.data ? t('table.summary', { count: rows.length, armed }) : undefined}
        >
          {alerts.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : alerts.isError ? (
            <div className="p-4">
              <ErrorState error={alerts.error} onRetry={() => void alerts.refetch()} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                <Button size="sm" onClick={openCreate}>
                  <BellPlus aria-hidden />
                  {t('actions.custom')}
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border text-left text-xs text-text-muted">
                    <th scope="col" className="px-4 py-2 font-medium">
                      {t('table.type')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('table.ticker')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      {t('table.trigger')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('table.status')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('table.created')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('table.rungAt')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      <span className="sr-only">{t('table.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr
                      key={a.id}
                      data-testid={`alert-row-${a.id}`}
                      className="border-b border-border last:border-b-0 hover:bg-surface2/50"
                    >
                      <td className="px-4 py-2">
                        <div className="text-text">{t(`types.${a.type}`)}</div>
                        {a.note && (
                          <div className="max-w-[16rem] truncate text-xs text-text-muted">
                            {a.note}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-semibold text-text">{a.symbol ?? '—'}</td>
                      <td className="tabular px-3 py-2 text-right text-text">
                        {alertTrigger(a, f.lang)}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge
                          size="sm"
                          status={a.status === 'armed' ? 'ready' : 'done'}
                          label={t(`status.${a.status}`)}
                        />
                      </td>
                      <td className="tabular px-3 py-2 text-xs text-text-muted">
                        {f.marketDateTime(a.createdAt)}
                      </td>
                      <td className="tabular px-3 py-2 text-xs text-text-muted">
                        {a.rungAt ? f.marketDateTime(a.rungAt) : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          {a.status === 'rung' && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={t('actions.rearmLabel', {
                                name: t(`types.${a.type}`),
                              })}
                              title={t('actions.rearm')}
                              disabled={update.isPending}
                              onClick={() => void rearm(a)}
                            >
                              <RotateCcw aria-hidden />
                            </Button>
                          )}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t('actions.editLabel', { name: t(`types.${a.type}`) })}
                            title={t('actions.edit')}
                            onClick={() => {
                              setEditing(a);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil aria-hidden />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t('actions.deleteLabel', { name: t(`types.${a.type}`) })}
                            title={t('actions.delete')}
                            onClick={() => setConfirm(a)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="px-4 py-3 text-xs text-text-muted">{t('table.ringsOnce')}</p>
        </Card>

        <NotificationSettings />
      </div>

      <AlertFormDialog open={formOpen} onOpenChange={setFormOpen} alert={editing} />
      <FromPlanDialog open={planOpen} onOpenChange={setPlanOpen} />

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('delete.title')}</DialogTitle>
            <DialogDescription>
              {confirm &&
                t('delete.description', {
                  name: t(`types.${confirm.type}`),
                  symbol: confirm.symbol ?? '',
                  value: alertTrigger(confirm, f.lang),
                })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button variant="danger" disabled={remove.isPending} onClick={() => void doDelete()}>
              <Trash2 aria-hidden />
              {t('actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
