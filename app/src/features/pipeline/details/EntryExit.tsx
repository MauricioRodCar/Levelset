import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Clock3 } from 'lucide-react';
import type { Bars, PipelineRun, Step } from '@/api';
import { TicketLevels } from '@/components/ticket/TicketLevels';
import { useFormat } from '@/i18n/useFormat';
import { arr, clock24, num, obj, str, values } from '../model';
import { BarsChart, LegendItem, SkillNote, Stat, StatRow } from './common';

const ET_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function barAt(bars: Bars['bars'], hhmm: string | null): number | null {
  if (!hhmm) return null;
  const b = bars.find((x) => ET_HM.format(new Date(x.t * 1000)) === hhmm);
  return b ? b.t : null;
}

export function EntryDetail({ step, run }: { step: Step; run: PipelineRun }) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const o = obj(step.outputs);
  const v = values(step);
  const orr = obj(o.opening_range);
  const trig = obj(o.trigger);
  const last = obj(o.last);
  const high = num(orr.high) ?? num(v.rangeHigh);
  const low = num(orr.low) ?? num(v.rangeLow);
  const level = num(o.level) ?? num(v.level);
  const status = str(o.status) ?? str(v.status);
  const trigPrice = num(trig.price);
  const trigTime = clock24(trig.time);
  const dist = num(last.vs_level_pct) ?? num(v.distancePct);
  const symbol = str(o.symbol) ?? run.ticker;
  const barStart = str(trig.bar_start);

  const build = useCallback(
    (data: Bars) => ({
      bars: data.bars,
      band:
        high !== null && low !== null
          ? { high, low }
          : data.rangeHigh != null && data.rangeLow != null
            ? { high: data.rangeHigh, low: data.rangeLow }
            : null,
      lines:
        level !== null && level !== high
          ? [{ price: level, kind: 'level' as const, title: t('entry.level') }]
          : [],
      markerTime: barAt(data.bars, barStart),
    }),
    [high, low, level, barStart, t],
  );

  return (
    <div>
      <p className="mb-3 text-sm text-text">
        {status === 'triggered'
          ? t('entry.sayTriggered', {
              bar: barStart ?? '–',
              price: trigPrice !== null ? f.price(trigPrice) : '–',
              level: level !== null ? f.price(level) : '–',
            })
          : status === 'waiting'
            ? t('entry.sayWaiting', {
                level: level !== null ? f.price(level) : '–',
                distance: dist !== null ? f.percent(Math.abs(dist), { fractionDigits: 2 }) : '–',
              })
            : t(`entry.say.${status ?? 'unknown'}`, { defaultValue: step.summary?.outLine ?? '' })}
      </p>
      <StatRow>
        <Stat label={t('entry.rangeHigh')} value={high !== null ? f.price(high) : '—'} />
        <Stat label={t('entry.rangeLow')} value={low !== null ? f.price(low) : '—'} />
        <Stat
          label={t('entry.trigger')}
          value={trigPrice !== null ? f.price(trigPrice) : '—'}
          hint={trigTime ? f.etClock(trigTime) : undefined}
        />
        <Stat
          label={t('entry.distance')}
          value={dist !== null ? f.percent(dist, { signed: true, fractionDigits: 2 }) : '—'}
          hint={
            num(last.close) !== null
              ? t('entry.lastClose', { value: f.price(num(last.close)!) })
              : undefined
          }
        />
      </StatRow>
      <div className="mt-4">
        <BarsChart
          symbol={symbol}
          runStartedAt={run.startedAt}
          build={build}
          ariaLabel={t('entry.chartLabel', { symbol: symbol ?? '' })}
          legend={
            <>
              <LegendItem
                swatch={
                  <span className="h-3 w-4 rounded-sm border border-accent/60 bg-accent/10" />
                }
                label={t('entry.legendBand', { minutes: num(orr.minutes) ?? 15 })}
              />
              <LegendItem
                swatch={<ArrowUp className="h-3.5 w-3.5 text-primary" aria-hidden />}
                label={t('entry.legendTrigger')}
              />
            </>
          }
        />
      </div>
      <SkillNote>{str(o.reason)}</SkillNote>
    </div>
  );
}

export function ExitDetail({ step, run }: { step: Step; run: PipelineRun }) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const o = obj(step.outputs);
  const entry = num(o.entry);
  const stop = num(o.stop);
  const target = num(o.target);
  const rule = str(o.stop_rule);
  const lines = useCallback(
    (data: Bars) => ({
      bars: data.bars,
      band: null,
      lines:
        entry !== null && stop !== null && target !== null
          ? [
              { price: entry, kind: 'entry' as const, title: t('levels.entry') },
              { price: stop, kind: 'stop' as const, title: t('levels.stop') },
              { price: target, kind: 'target' as const, title: t('levels.target') },
            ]
          : [],
    }),
    [entry, stop, target, t],
  );
  if (entry === null || stop === null || target === null)
    return <p className="text-sm text-text-muted">{step.error ?? step.summary?.outLine}</p>;
  return (
    <div>
      <TicketLevels entry={entry} stop={stop} target={target} />
      <p className="mt-2 text-xs text-text-muted">
        {t('exit.secondary', {
          risk: f.price(num(o.risk_per_share) ?? entry - stop),
          rr: f.price(num(o.reward_risk) ?? 0),
          flatBy: f.etClock(str(o.flat_by) ?? '15:55'),
        })}
      </p>
      <StatRow>
        <Stat
          className="mt-3"
          label={t('exit.stopRule')}
          value={rule ? t(`exit.stopRules.${rule}`, { defaultValue: rule }) : '—'}
        />
        <Stat
          className="mt-3"
          label={t('exit.targetRule')}
          value={
            num(o.target_r) !== null ? t('exit.targetR', { r: f.number(num(o.target_r)!, 2) }) : '—'
          }
        />
      </StatRow>
      {arr<string>(o.warnings).length > 0 && (
        <ul className="mt-3 space-y-1">
          {arr<string>(o.warnings).map((w) => (
            <li key={w} className="text-xs text-text" lang="en">
              {w}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <BarsChart
          symbol={str(o.symbol) ?? run.ticker}
          runStartedAt={run.startedAt}
          build={lines}
          ariaLabel={t('exit.chartLabel', { symbol: str(o.symbol) ?? run.ticker ?? '' })}
          legend={
            <>
              <LegendItem
                swatch={<span className="h-0.5 w-4 bg-text-muted" />}
                label={t('levels.entry')}
              />
              <LegendItem
                swatch={<span className="h-0 w-4 border-t-2 border-dashed border-loss" />}
                label={t('levels.stop')}
              />
              <LegendItem
                swatch={<span className="h-0 w-4 border-t-2 border-dashed border-profit" />}
                label={t('levels.target')}
              />
              <LegendItem
                swatch={<Clock3 className="h-3.5 w-3.5" aria-hidden />}
                label={t('exit.flatBy', { time: f.etClock(str(o.flat_by) ?? '15:55') })}
              />
            </>
          }
        />
      </div>
      <SkillNote>{[str(o.stop_detail), str(o.note)].filter(Boolean).join(' · ')}</SkillNote>
    </div>
  );
}
