import { useEffect, useState } from 'react';
import { MonitorUp, ShieldCheck, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  BRIDGE_PLATFORMS,
  useBridgeSettings,
  useBridgeStatus,
  useCancelBridge,
  useSendToBridge,
  useSymbolMap,
  type BridgePlatform,
  type BridgeTicketPlatform,
  type Ticket,
} from '@/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { useFormat } from '@/i18n/useFormat';
import { BridgeStateBadge } from './BridgesSection';
import { previewVolume, useBridgeErrorMessage } from './bridgeUi';

const UNIT: Record<BridgePlatform, 'units' | 'lots'> = {
  ctrader: 'units',
  mt4: 'lots',
  mt5: 'lots',
};

/**
 * "Send to platform" for a PASS ticket. Levelset writes a signal file; the cBot / EA shows it on the
 * chart and the order is placed only when the user clicks Place there. No auto-place anywhere.
 */
export function SendToPlatformDialog({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('connections');
  const f = useFormat();
  const settings = useBridgeSettings();
  const status = useBridgeStatus();
  const map = useSymbolMap();
  const send = useSendToBridge();
  const errorMessage = useBridgeErrorMessage();
  const enabled = BRIDGE_PLATFORMS.filter((p) => settings.data?.platforms[p].enabled);
  const [picked, setPicked] = useState<BridgePlatform[]>([]);

  const enabledKey = enabled.join(',');
  useEffect(() => {
    if (open) setPicked(enabledKey ? (enabledKey.split(',') as BridgePlatform[]) : []);
  }, [open, enabledKey]);

  const lines = enabled.map((p) => {
    const row = map.data?.rows.find((r) => r.platform === p && r.usSymbol === ticket.symbol);
    const volume = row ? previewVolume(ticket.qty, row) : 0;
    const unit = t(`bridges.send.units.${UNIT[p]}`);
    const problem = !row
      ? t('bridges.send.unmapped', { symbol: ticket.symbol })
      : volume < row.minVolume || volume <= 0
        ? t('bridges.send.tooSmall', { volume: f.number(volume, 2), unit, min: row.minVolume })
        : null;
    return { p, row, volume, unit, problem };
  });
  const sendable = picked.filter((p) => !lines.find((l) => l.p === p)?.problem);

  const submit = () =>
    send.mutate(
      { ticketId: ticket.id, platforms: sendable },
      {
        onSuccess: () => {
          toast(t('bridges.send.sent'));
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('bridges.send.title', { symbol: ticket.symbol })}</DialogTitle>
          <DialogDescription className="text-sm text-text-muted">
            {t('bridges.send.description')}
          </DialogDescription>
        </DialogHeader>
        {settings.data && enabled.length === 0 ? (
          <p className="rounded-md bg-surface2 px-3 py-3 text-sm text-text">
            {t('bridges.send.noPlatforms')}{' '}
            <Link
              to="/connections"
              onClick={() => onOpenChange(false)}
              className="rounded text-accent hover:underline focus-ring"
            >
              {t('bridges.send.goToConnections')}
            </Link>
          </p>
        ) : (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text">
              {t('bridges.send.platforms')}
            </legend>
            <ul className="space-y-2">
              {lines.map(({ p, row, volume, unit, problem }) => {
                const st = status.data?.find((s) => s.platform === p);
                const id = `send-${ticket.id}-${p}`;
                return (
                  <li
                    key={p}
                    className="flex items-start gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <Checkbox
                      id={id}
                      checked={picked.includes(p) && !problem}
                      disabled={!!problem}
                      onCheckedChange={(v) =>
                        setPicked((cur) => (v ? [...cur, p] : cur.filter((x) => x !== p)))
                      }
                      className="mt-0.5"
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-text">{t(`platforms.${p}.name`)}</span>
                        {st && <BridgeStateBadge state={st.state} />}
                      </span>
                      <span className="tabular block text-xs text-text-muted">
                        {problem ??
                          t('bridges.send.volume', {
                            symbol: row?.brokerSymbol,
                            volume: f.number(volume, volume % 1 ? 2 : 0),
                            unit,
                          })}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}
        <p className="mt-4 flex items-start gap-2 text-xs text-text-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          {t('bridges.install.safety')}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!sendable.length || send.isPending}>
            <MonitorUp aria-hidden />
            {t('bridges.send.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function platformText(
  t: (k: string, o?: Record<string, unknown>) => string,
  pl: BridgeTicketPlatform,
) {
  return t(`bridges.ticket.states.${pl.state}`, { error: pl.error ?? '' });
}

/** Ticket.bridge on the ticket card: state per platform and "Cancel in platform". */
export function BridgeTicketLine({ ticket }: { ticket: Ticket }) {
  const { t } = useTranslation('connections');
  const cancel = useCancelBridge();
  const errorMessage = useBridgeErrorMessage();
  const b = ticket.bridge;
  if (!b) return null;
  const canCancel =
    !b.cancelledAt && b.platforms.some((pl) => ['written', 'shown'].includes(pl.state));
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted"
      data-testid="bridge-line"
    >
      <MonitorUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-medium text-text">{t('bridges.ticket.label')}:</span>
      {b.platforms.map((pl, i) => (
        <span key={pl.platform} data-state={pl.state}>
          {i > 0 && <span aria-hidden>· </span>}
          {t(`platforms.${pl.platform}.name`)} — {platformText(t, pl)}
        </span>
      ))}
      {canCancel && (
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2 text-xs"
          disabled={cancel.isPending}
          onClick={() =>
            cancel.mutate(ticket.id, {
              onSuccess: () => toast(t('bridges.ticket.cancelled')),
              onError: (err) => toast.error(errorMessage(err)),
            })
          }
        >
          <XCircle aria-hidden />
          {t('bridges.ticket.cancel')}
        </Button>
      )}
    </div>
  );
}
