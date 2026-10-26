import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useReportsThisWeek } from '@/api';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Small "Earnings this week" pill (AnalystReport.reportsThisWeek) for tickets and the watchlist.
 * Renders nothing when the company does not report this week or the SEC data is unavailable.
 * Icon + label, never colour alone; small text so it never competes with the ticket levels.
 * iconOnly (narrow columns): the calendar icon with the label as its accessible name and tooltip.
 */
export function EarningsBadge({
  symbol,
  iconOnly,
  className,
}: {
  symbol: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('analyst');
  const reports = useReportsThisWeek(symbol);
  if (!reports) return null;
  const label = t('badge.label');
  return (
    <SimpleTooltip
      label={
        <span className="block max-w-xs">
          <span className="block font-medium">{label}</span>
          {t('badge.tooltip')}
        </span>
      }
    >
      <span
        tabIndex={0}
        role={iconOnly ? 'img' : undefined}
        aria-label={iconOnly ? label : undefined}
        data-testid={`earnings-badge-${symbol}`}
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-warning/40 bg-warning/10 text-[11px] font-medium leading-none text-text focus-ring',
          iconOnly ? 'p-0.5' : 'px-1.5 py-0.5',
          className,
        )}
      >
        <CalendarClock className="h-3 w-3 text-warning" aria-hidden />
        {!iconOnly && label}
      </span>
    </SimpleTooltip>
  );
}
