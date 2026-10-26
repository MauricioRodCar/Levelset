import { useTranslation } from 'react-i18next';
import { CircleCheck, CircleX, Lock } from 'lucide-react';
import { useTicket, type PipelineRun, type Step } from '@/api';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/Skeleton';
import { TicketCard } from '@/components/ticket/TicketCard';
import { TicketLevels } from '@/components/ticket/TicketLevels';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';
import { arr, num, obj, slug, str, values } from '../model';
import { useStepText } from '../useStepText';
import { SectionTitle, SkillNote, Stat, StatRow } from './common';

export function BudgetDetail({ step }: { step: Step }) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const text = useStepText();
  const s = obj(obj(step.outputs).sizing);
  const limits = arr(s.limits);
  const bound = str(s.bound_by);
  const refusal = str(s.refusal);
  const qty = num(s.qty);
  return (
    <div>
      {refusal ? (
        <p className="mb-3 text-sm text-text">
          {t('budget.refused', { reason: (step.checks ?? []).map(text.check).join('; ') })}
        </p>
      ) : (
        bound && (
          <p className="mb-3 text-sm text-text">
            {t('budget.decided', {
              limit: t(`budget.limits.${slug(bound)}`, { defaultValue: bound }),
              qty: qty ?? '–',
            })}
          </p>
        )
      )}
      <StatRow>
        <Stat label={t('budget.qty')} value={qty !== null ? f.number(qty, 0) : '—'} />
        <Stat label={t('budget.cost')} value={num(s.cost) !== null ? f.money(num(s.cost)!) : '—'} />
        <Stat
          label={t('budget.maxLoss')}
          value={num(s.max_loss) !== null ? f.money(num(s.max_loss)!) : '—'}
        />
        <Stat
          label={t('budget.riskPerShare')}
          value={num(s.risk_per_share) !== null ? f.price(num(s.risk_per_share)!) : '—'}
        />
      </StatRow>
      {limits.length > 0 && (
        <>
          <SectionTitle>{t('budget.limitsTitle')}</SectionTitle>
          <table className="w-full text-sm">
            <thead className="text-xs text-text-muted">
              <tr>
                <th className="py-1 text-left font-medium">{t('budget.col.limit')}</th>
                <th className="py-1 text-right font-medium">{t('budget.col.shares')}</th>
                <th className="py-1 pl-4 text-left font-medium">{t('budget.col.how')}</th>
              </tr>
            </thead>
            <tbody>
              {limits.map((l) => {
                const name = String(l.name ?? '');
                const binds = l.binds === true;
                return (
                  <tr
                    key={name}
                    className={cn('border-t border-border', binds && 'bg-primary/10')}
                    data-binds={binds || undefined}
                  >
                    <td className="py-1.5 pr-2 text-text">
                      <span className="inline-flex items-center gap-1.5">
                        {binds && <Lock className="h-3.5 w-3.5 text-primary" aria-hidden />}
                        {t(`budget.limits.${slug(name)}`, { defaultValue: name })}
                        {binds && (
                          <span className="rounded border border-primary/50 px-1 text-[11px]">
                            {t('budget.decides')}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="tabular py-1.5 text-right font-semibold">
                      {num(l.shares) ?? '—'}
                    </td>
                    <td className="py-1.5 pl-4 text-xs text-text-muted" lang="en">
                      {str(l.how)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      <SkillNote>{refusal ?? str(obj(arr(obj(step.outputs).orders)[0]).why)}</SkillNote>
    </div>
  );
}

interface Rule {
  id: string;
  codes: string[];
  detail?: string;
}

export function RiskDetail({ step }: { step: Step }) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const text = useStepText();
  const o = obj(step.outputs);
  const r = obj(arr(o.results)[0]);
  const v = values(step);
  const verdict = str(r.verdict) ?? str(v.verdict);
  const failing = new Set(step.checks ?? []);
  const m = (k: string) => (num(v[k]) !== null ? f.money(num(v[k])!) : '–');
  const n2 = (k: string) => (num(v[k]) !== null ? f.price(num(v[k])!) : '–');
  const after =
    num(v.lossAtRisk) !== null && num(v.maxLoss) !== null
      ? f.money(num(v.lossAtRisk)! + num(v.maxLoss)!)
      : '–';
  const rules: Rule[] = [
    {
      id: 'stop',
      codes: ['stop', 'no_stop'],
      detail:
        num(r.stop) !== null ? t('risk.detail.stop', { stop: f.price(num(r.stop)!) }) : undefined,
    },
    {
      id: 'max_loss',
      codes: ['loss', 'max_loss', 'max_loss_per_trade', 'size'],
      detail: t('risk.detail.maxLoss', { value: m('maxLoss'), limit: m('maxLossLimit') }),
    },
    {
      id: 'reward_risk',
      codes: ['reward_risk', 'min_rr'],
      detail: t('risk.detail.rewardRisk', { value: n2('rewardRisk'), min: n2('minRewardRisk') }),
    },
    {
      id: 'daily',
      codes: ['daily_limit', 'daily_loss'],
      detail: t('risk.detail.daily', { value: after, limit: m('dailyLossLimit') }),
    },
    {
      id: 'trades',
      codes: ['trades', 'trades_per_day'],
      detail: t('risk.detail.trades', {
        value: num(v.tradesToday) ?? '–',
        max: num(v.maxTradesPerDay) ?? '–',
      }),
    },
    { id: 'window', codes: ['window', 'entry_window', 'market_closed'] },
    { id: 'cash', codes: ['cash', 'position'] },
    { id: 'order', codes: [] },
  ];
  const known = new Set(rules.flatMap((x) => x.codes));
  const orderFails = [...failing].filter((c) => !known.has(c));
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {verdict && (
          <StatusBadge
            status={verdict === 'PASS' ? 'pass' : 'block'}
            label={verdict === 'PASS' ? t('risk.pass') : t('risk.block')}
          />
        )}
        <span className="text-sm text-text">
          {verdict === 'PASS' ? t('risk.passSay') : t('risk.blockSay')}
        </span>
      </div>
      <ul
        className="divide-y divide-border rounded-md border border-border"
        aria-label={t('risk.checklist')}
      >
        {rules.map((rule) => {
          const fails = rule.id === 'order' ? orderFails : rule.codes.filter((c) => failing.has(c));
          const ok = fails.length === 0;
          const Icon = ok ? CircleCheck : CircleX;
          return (
            <li
              key={rule.id}
              className="flex items-start gap-2.5 px-3 py-2"
              data-rule={rule.id}
              data-pass={ok}
            >
              <Icon
                className={cn('mt-0.5 h-4 w-4 shrink-0', ok ? 'text-profit' : 'text-loss')}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-text">
                    {t(`risk.rules.${rule.id}`)}
                  </span>
                  <span className="text-xs text-text-muted">
                    {ok ? t('risk.ok') : t('risk.fail')}
                  </span>
                </div>
                {rule.detail && (
                  <div className="tabular text-xs text-text-muted">{rule.detail}</div>
                )}
                {fails.map((c) => (
                  <div key={c} className="text-xs text-text">
                    {text.check(c)}
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {arr<string>(r.reasons).length > 0 && (
        <SkillNote>{arr<string>(r.reasons).join(' · ')}</SkillNote>
      )}
      {arr<string>(r.info).length > 0 && <SkillNote>{arr<string>(r.info).join(' · ')}</SkillNote>}
    </div>
  );
}

export function TicketDetail({ step, run }: { step: Step; run: PipelineRun }) {
  const { t } = useTranslation('pipeline');
  const v = values(step);
  const ticketId = str(v.ticketId) ?? run.ticketId ?? undefined;
  const q = useTicket(ticketId);
  if (ticketId && q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.data) return <TicketCard ticket={q.data} />;
  const entry = num(v.entry);
  const stop = num(v.stop);
  const target = num(v.target);
  if (entry !== null && stop !== null && target !== null)
    return (
      <div>
        <TicketLevels entry={entry} stop={stop} target={target} />
        <p className="mt-2 text-xs text-text-muted">{t('ticket.notStored')}</p>
      </div>
    );
  return <p className="text-sm text-text-muted">{step.summary?.outLine ?? t('ticket.none')}</p>;
}
