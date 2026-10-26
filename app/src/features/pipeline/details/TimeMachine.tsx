import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck, CircleX, Clock3 } from 'lucide-react';
import type { Step } from '@/api';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';
import { arr, clock24, num, obj, str, values } from '../model';
import { LegendItem, SectionTitle, SkillNote } from './common';

export function TimeMachineDetail({ step }: { step: Step }) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const [showAll, setShowAll] = useState(false);
  const o = obj(step.outputs);
  const mc = obj(o.mc);
  const h = obj(o.history);
  const v = values(step);
  const pct = (vKey: string, mcKey: string) =>
    num(v[vKey]) ?? (num(mc[mcKey]) !== null ? Math.round(num(mc[mcKey])! * 1000) / 10 : 0);
  const target = pct('targetFirstPct', 'p_target');
  const stop = pct('stopFirstPct', 'p_stop');
  const open = pct('openAtClosePct', 'p_neither');
  const verdict = str(v.verdict) ?? 'coin_flip';
  const fired = num(v.historyFired) ?? num(h.triggered) ?? 0;
  const won = num(v.historyWon) ?? num(h.target) ?? 0;
  const lost = num(v.historyLost) ?? num(h.stop) ?? 0;
  const neither = num(v.historyNeither) ?? num(h.close) ?? Math.max(0, fired - won - lost);
  const trades = arr(h.trades);
  const shown = showAll ? trades : trades.slice(-8);
  const until = str(mc.until) ?? '16:00';
  const segments = [
    { key: 'target', value: target, cls: 'bg-profit', icon: CircleCheck, iconCls: 'text-profit' },
    { key: 'stop', value: stop, cls: 'bg-loss', icon: CircleX, iconCls: 'text-loss' },
    { key: 'open', value: open, cls: 'bg-text-muted/50', icon: Clock3, iconCls: 'text-text-muted' },
  ] as const;

  return (
    <div>
      <p className="text-sm text-text" data-testid="tm-verdict">
        {t(`timemachine.verdict.${verdict}`, {
          target: f.percent(target),
          stop: f.percent(stop),
          open: f.percent(open),
          time: f.etClock(clock24(until) ?? until),
        })}
      </p>

      <SectionTitle>
        {t('timemachine.outcomes', {
          replays: f.number(num(mc.replays) ?? num(v.replays) ?? 10000, 0),
          seed: num(mc.seed) ?? num(v.seed) ?? '–',
        })}
      </SectionTitle>
      <div
        className="flex h-4 w-full overflow-hidden rounded-full bg-surface2"
        role="img"
        aria-label={t('timemachine.barLabel', {
          target: f.percent(target),
          stop: f.percent(stop),
          open: f.percent(open),
        })}
      >
        {segments.map((s) => (
          <span key={s.key} className={cn('h-full', s.cls)} style={{ width: `${s.value}%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {segments.map((s) => (
          <LegendItem
            key={s.key}
            swatch={<s.icon className={cn('h-3.5 w-3.5', s.iconCls)} aria-hidden />}
            label={
              <>
                {t(`timemachine.legend.${s.key}`, { time: f.etClock(clock24(until) ?? until) })}{' '}
                <span className="tabular font-semibold text-text">{f.percent(s.value)}</span>
              </>
            }
          />
        ))}
      </ul>

      <CloseDistribution mc={mc} />

      <SectionTitle>{t('timemachine.history', { sessions: num(h.sessions) ?? '–' })}</SectionTitle>
      <table className="w-full max-w-md text-sm">
        <thead className="text-xs text-text-muted">
          <tr>
            <th className="py-1 text-left font-medium">{t('timemachine.col.fired')}</th>
            <th className="py-1 text-left font-medium">{t('timemachine.col.won')}</th>
            <th className="py-1 text-left font-medium">{t('timemachine.col.lost')}</th>
            <th className="py-1 text-left font-medium">{t('timemachine.col.open')}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="tabular text-base font-semibold text-text">
            <td className="py-1">{fired}</td>
            <td className="py-1">{won}</td>
            <td className="py-1">{lost}</td>
            <td className="py-1">{neither}</td>
          </tr>
        </tbody>
      </table>

      {trades.length > 0 && (
        <>
          <div className="mt-3 max-h-64 overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface2 text-xs text-text-muted">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">{t('timemachine.col.date')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('levels.entry')}</th>
                  <th className="px-3 py-1.5 text-left font-medium">
                    {t('timemachine.col.outcome')}
                  </th>
                  <th className="px-3 py-1.5 text-right font-medium">R</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((tr, i) => {
                  const outcome = str(tr.outcome) ?? 'close';
                  const Icon =
                    outcome === 'target' ? CircleCheck : outcome === 'stop' ? CircleX : Clock3;
                  const time = clock24(tr.time);
                  return (
                    <tr key={`${String(tr.date)}-${i}`} className="border-t border-border">
                      <td className="tabular px-3 py-1.5 text-text-muted">
                        {str(tr.date) ? f.marketDate(`${String(tr.date)}T12:00:00-04:00`) : '—'}
                        {time ? ` · ${f.etClock(time)}` : ''}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">
                        {num(tr.entry) !== null ? f.price(num(tr.entry)!) : '—'}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1.5 text-text">
                          <Icon
                            className={cn(
                              'h-3.5 w-3.5',
                              outcome === 'target'
                                ? 'text-profit'
                                : outcome === 'stop'
                                  ? 'text-loss'
                                  : 'text-text-muted',
                            )}
                            aria-hidden
                          />
                          {t(`timemachine.outcome.${outcome}`, { defaultValue: outcome })}
                        </span>
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">
                        {num(tr.R) !== null ? f.number(num(tr.R)!, 2) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {trades.length > 8 && (
            <Button variant="link" size="sm" className="mt-1" onClick={() => setShowAll((x) => !x)}>
              {showAll
                ? t('timemachine.showLess')
                : t('timemachine.showAll', { count: trades.length })}
            </Button>
          )}
        </>
      )}
      <SkillNote>{[str(o.verdict), str(o.note)].filter(Boolean).join(' ')}</SkillNote>
    </div>
  );
}

function CloseDistribution({ mc }: { mc: Record<string, unknown> }) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const hist = obj(mc.hist);
  const bins = arr<number>(hist.bins).filter((n) => typeof n === 'number');
  const lo = num(hist.lo);
  const hi = num(hist.hi);
  if (!bins.length || lo === null || hi === null) return null;
  const max = Math.max(...bins, 1);
  const p5 = num(mc.p5_close);
  const med = num(mc.median_close);
  const p95 = num(mc.p95_close);
  return (
    <>
      <SectionTitle>{t('timemachine.distribution')}</SectionTitle>
      <div
        className="flex h-16 items-end gap-px"
        role="img"
        aria-label={t('timemachine.distributionLabel', {
          p5: p5 !== null ? f.price(p5) : '–',
          median: med !== null ? f.price(med) : '–',
          p95: p95 !== null ? f.price(p95) : '–',
        })}
      >
        {bins.map((b, i) => (
          <span
            key={i}
            className="flex-1 rounded-t-sm bg-accent/50"
            style={{ height: `${Math.max(4, (b / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="tabular mt-1 flex justify-between text-[11px] text-text-muted">
        <span>{f.price(lo)}</span>
        {med !== null && (
          <span>
            {t('timemachine.median', { value: f.price(med) })}
            {p5 !== null && p95 !== null
              ? ` · ${t('timemachine.middle90', { lo: f.price(p5), hi: f.price(p95) })}`
              : ''}
          </span>
        )}
        <span>{f.price(hi)}</span>
      </div>
    </>
  );
}
