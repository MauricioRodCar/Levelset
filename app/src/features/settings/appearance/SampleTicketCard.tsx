import { Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/CopyButton';
import { KpiTile } from '@/components/KpiTile';
import { StatusBadge } from '@/components/StatusBadge';
import { TicketLevels } from '@/components/ticket/TicketLevels';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/i18n/useFormat';

/** Sample data for the preview (TSLA 2026-10-19 example). */
const SAMPLE = {
  side: 'buy',
  qty: 8,
  symbol: 'TSLA',
  entry: 364.18,
  stop: 358.32,
  target: 370.04,
  maxLoss: 46.88,
  r: 1,
  verdict: 'coin_flip',
  flatBy: '15:55',
} as const;

/**
 * Live preview of a ticket card following the ticket rule. Used by Settings > Appearance.
 * WP3 builds the real TicketCard on the same <TicketLevels> component.
 */
export function SampleTicketCard() {
  const { t } = useTranslation('tickets');
  const f = useFormat();
  const s = SAMPLE;
  const fullText = `${s.side.toUpperCase()} ${s.qty} ${s.symbol}\nEntry ${s.entry.toFixed(2)}\nStop loss ${s.stop.toFixed(2)}\nTake profit ${s.target.toFixed(2)}`;
  return (
    <article
      className="rounded-lg border border-border bg-surface p-4"
      aria-label={t('preview.label')}
    >
      <header className="mb-3 flex items-center gap-3">
        <span className="text-sm font-semibold text-text">
          {t(`side.${s.side}`)} {s.qty} {s.symbol}
        </span>
        <span className="text-xs text-text-muted">
          {t('orderType.market')} · {t('timeInForce.day')}
        </span>
        <StatusBadge status="pass" label={t('risk.pass')} size="sm" className="ml-auto" />
      </header>
      <TicketLevels entry={s.entry} stop={s.stop} target={s.target} />
      <p className="tabular mt-3 text-xs text-text-muted">
        {t('secondary.maxLoss', { value: f.money(s.maxLoss) })} ·{' '}
        {t('secondary.r', { value: f.number(s.r) })} ·{' '}
        {t('secondary.odds', { verdict: t(`verdict.${s.verdict}`) })}
        <span className="float-right">{t('secondary.flatBy', { time: f.etClock(s.flatBy) })}</span>
      </p>
      <div className="mt-3 flex gap-2">
        <CopyButton
          value={fullText}
          toastValue={s.symbol}
          label={t('actions.copyAll')}
          variant="primary"
          size="sm"
          className="text-on-primary hover:text-on-primary"
        />
        <Button size="sm" variant="outline" disabled>
          <Workflow aria-hidden />
          {t('actions.viewFlow')}
        </Button>
      </div>
    </article>
  );
}

export function SampleKpi() {
  const { t } = useTranslation('dashboard');
  const f = useFormat();
  return (
    <KpiTile
      label={t('kpi.riskUsed')}
      value={f.money(48)}
      sub={t('kpi.ofLimit', { limit: f.money(95) })}
      progress={48 / 95}
      progressLabel={t('kpi.riskUsed')}
    />
  );
}
