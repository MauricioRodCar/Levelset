import { useTranslation } from 'react-i18next';
import type { DashboardSummary } from '@/api';
import { KpiTile } from '@/components/KpiTile';
import { useFormat } from '@/i18n/useFormat';

/** Day P/L · Risk used / limit · Trades today / max · Setups found. */
export function KpiRow({ data, loading }: { data?: DashboardSummary; loading?: boolean }) {
  const { t } = useTranslation('dashboard');
  const f = useFormat();
  const d = data;
  const pnl = d?.dayPnl ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpi-row">
      <KpiTile
        label={t('kpi.dayPnl')}
        loading={loading}
        value={d ? f.money(pnl, { signed: true }) : '—'}
        trend={pnl > 0 ? 'up' : pnl < 0 ? 'down' : undefined}
        sub={t('kpi.dayPnlSub')}
      />
      <KpiTile
        label={t('kpi.riskUsed')}
        loading={loading}
        value={d ? f.money(d.riskUsed) : '—'}
        sub={d ? t('kpi.ofLimit', { limit: f.money(d.dailyLossLimit) }) : undefined}
        progress={d && d.dailyLossLimit > 0 ? d.riskUsed / d.dailyLossLimit : undefined}
        progressLabel={t('kpi.riskUsed')}
      />
      <KpiTile
        label={t('kpi.tradesToday')}
        loading={loading}
        value={d ? f.number(d.tradesToday, 0) : '—'}
        sub={d ? t('kpi.ofMax', { max: f.number(d.maxTradesPerDay, 0) }) : undefined}
        progress={d && d.maxTradesPerDay > 0 ? d.tradesToday / d.maxTradesPerDay : undefined}
        progressLabel={t('kpi.tradesToday')}
      />
      <KpiTile
        label={t('kpi.setupsFound')}
        loading={loading}
        value={d ? f.number(d.setupsFound, 0) : '—'}
        sub={
          d
            ? d.lastScanAt
              ? t('kpi.lastScan', { time: f.marketTime(d.lastScanAt) })
              : t('kpi.noScan')
            : undefined
        }
      />
    </div>
  );
}
