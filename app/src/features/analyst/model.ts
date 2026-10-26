/** "What changed" codes (AnalystChange) -> sentences in the UI language. */
import type { AnalystChange } from '@/api';
import type { useResearchFormat } from './format';

type ResearchFormat = ReturnType<typeof useResearchFormat>;
export type T = (key: string, opts?: Record<string, unknown>) => string;

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** One structured "what changed" line in the UI language (analyst:change.<code>). */
export function changeText(c: AnalystChange, t: T, rf: ResearchFormat): string {
  const v = c.values as Record<string, unknown>;
  switch (c.code) {
    case 'quarter_summary':
      return t(v.derived ? 'change.quarter_summary_derived' : 'change.quarter_summary', {
        end: rf.day(v.end as string),
        revenue: rf.big(num(v.revenue)),
        revenueYoy: rf.signedPct(num(v.revenueYoyPct)),
        netIncome: rf.big(num(v.netIncome)),
        netIncomeYoy: rf.signedPct(num(v.netIncomeYoyPct)),
        eps: rf.eps(num(v.epsDiluted)),
        epsYoy: rf.signedPct(num(v.epsDilutedYoyPct)),
      });
    case 'gross_margin':
    case 'operating_margin':
    case 'net_margin': {
      const qoq = num(v.qoqPts);
      return t(qoq == null ? `change.${c.code}` : `change.${c.code}_qoq`, {
        value: rf.pct(num(v.valuePct)),
        pts: rf.pts(qoq),
      });
    }
    case 'net_above_operating':
      return t('change.net_above_operating', {
        netIncome: rf.big(num(v.netIncome)),
        operatingIncome: rf.big(num(v.operatingIncome)),
      });
    case 'revenue_qoq':
      return t('change.revenue_qoq', { pct: rf.signedPct(num(v.pct)) });
    case 'facts_stale':
      return t('change.facts_stale', {
        latestEnd: rf.day(v.latestEnd as string),
        form: String(v.form ?? ''),
        period: rf.day(v.period as string),
        filed: rf.day(v.filed as string),
      });
    case 'derived_quarters':
      return t('change.derived_quarters');
    default:
      return c.text;
  }
}
