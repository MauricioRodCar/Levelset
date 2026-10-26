import type { TFunction } from 'i18next';
import type { Ticket } from '@/api';
import { priceForCopy } from '@/lib/format';

/**
 * Plain-text ticket for the clipboard ("Copy full ticket").
 * Labels follow the UI language; numbers are always dot-decimal so platforms accept them.
 */
export function ticketText(ticket: Ticket, t: TFunction): string {
  const p = priceForCopy;
  const head = [
    `${t('tickets:side.' + ticket.side)} ${ticket.qty} ${ticket.symbol}`,
    t('tickets:orderType.' + ticket.orderType),
    ticket.timeInForce ? t('tickets:timeInForce.' + ticket.timeInForce) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const tail = [
    t('tickets:copyText.maxLoss', { value: `$${p(ticket.maxLoss)}` }),
    `${p(ticket.rMultiple)}R`,
    ticket.flatBy ? t('tickets:copyText.flatBy', { time: `${ticket.flatBy} ET` }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return [
    head,
    `${t('tickets:levels.entry')} ${p(ticket.entry)}`,
    `${t('tickets:levels.stop')} ${p(ticket.stop)}`,
    `${t('tickets:levels.target')} ${p(ticket.target)}`,
    tail,
  ].join('\n');
}
