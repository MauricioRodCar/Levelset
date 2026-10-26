import { useTranslation } from 'react-i18next';
import type { TicketPaper } from '@/api';
import { PaperBadge } from '@/components/PaperBadge';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';

/**
 * Secondary ticket line for auto-follow (Ticket.paper): "Paper: opened 364.29".
 * 12 px muted like the other secondary lines; it never touches the ticket levels.
 */
export function PaperLine({ paper, className }: { paper: TicketPaper; className?: string }) {
  const { t } = useTranslation('paper');
  const f = useFormat();
  let text: string;
  if (paper.status === 'opened' && paper.entryPrice != null)
    text = t('ticket.opened', { price: f.price(paper.entryPrice) });
  else if (paper.status === 'closed' && paper.exitPrice != null)
    text = t('ticket.closed', {
      price: f.price(paper.exitPrice),
      reason: paper.exitReason ? t(`exitReason.${paper.exitReason}`) : '',
      pnl: f.money(paper.pnl ?? 0, { signed: true }),
    });
  else if (paper.status === 'skipped')
    text = t('ticket.skipped', { reason: t(`skipReason.${paper.skipReason ?? 'blocked'}`) });
  else text = t('ticket.pending');
  return (
    <p
      className={cn('tabular flex items-center gap-1.5 text-xs text-text-muted', className)}
      data-testid="ticket-paper"
    >
      <PaperBadge />
      <span>{text}</span>
      {paper.backfilled && <span>· {t('log.backfilled')}</span>}
    </p>
  );
}
