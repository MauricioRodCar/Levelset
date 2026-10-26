import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Ticket } from '@/api';
import { CopyButton } from '@/components/CopyButton';
import { useFormat } from '@/i18n/useFormat';
import { priceForCopy } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PlatformId } from './platforms';

export interface PlatformHowToProps {
  platform: PlatformId;
  /** When given, the ticket's own values are shown above the steps, each with a copy button. */
  ticket?: Ticket;
  className?: string;
}

/** Step-by-step guide for entering a market order with stop loss and take profit on a platform. */
export function PlatformHowTo({ platform, ticket, className }: PlatformHowToProps) {
  const { t } = useTranslation('connections');
  const steps = t(`platforms.${platform}.steps`, { returnObjects: true }) as string[];
  return (
    <div className={cn('space-y-3', className)}>
      {ticket && <TicketValues ticket={ticket} />}
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-text marker:text-text-muted">
        {steps.map((s, i) => (
          <li key={i} className="pl-1">
            {s}
          </li>
        ))}
      </ol>
      <p className="flex gap-2 text-xs text-text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t(`platforms.${platform}.note`)}</span>
      </p>
    </div>
  );
}

function TicketValues({ ticket }: { ticket: Ticket }) {
  const { t } = useTranslation('connections');
  const { t: tt } = useTranslation('tickets');
  const f = useFormat();
  const rows: { label: string; display: string; copy?: string; toast?: string }[] = [
    { label: t('howto.symbol'), display: ticket.symbol, copy: ticket.symbol, toast: ticket.symbol },
    { label: t('howto.side'), display: tt(`side.${ticket.side}`) },
    {
      label: t('howto.quantity'),
      display: f.number(ticket.qty, 0),
      copy: String(ticket.qty),
      toast: String(ticket.qty),
    },
    {
      label: tt('levels.stop'),
      display: f.price(ticket.stop),
      copy: priceForCopy(ticket.stop),
      toast: f.price(ticket.stop),
    },
    {
      label: tt('levels.target'),
      display: f.price(ticket.target),
      copy: priceForCopy(ticket.target),
      toast: f.price(ticket.target),
    },
  ];
  return (
    <div className="rounded-md border border-border bg-surface2 p-3">
      <p className="mb-2 text-xs font-medium text-text-muted">{t('howto.yourValues')}</p>
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-xs text-text-muted">{r.label}</dt>
            <dd className="tabular text-base font-medium text-text">{r.display}</dd>
            <dd className="flex h-7 w-7 items-center">
              {r.copy && <CopyButton value={r.copy} toastValue={r.toast} />}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
