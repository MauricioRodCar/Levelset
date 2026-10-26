import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Step } from '@/api';
import { useFormat } from '@/i18n/useFormat';
import { clock24, num, obj, slug, str, type Obj } from './model';

const PRICE = new Set([
  'price',
  'rangeHigh',
  'rangeLow',
  'entry',
  'stop',
  'target',
  'riskPerShare',
  'level',
  'lastClose',
  'medianClose',
  'p5Close',
  'p95Close',
]);
const MONEY = new Set([
  'maxLoss',
  'cost',
  'budget',
  'maxLossPerTrade',
  'maxLossLimit',
  'dailyLossLimit',
  'lossAtRisk',
  'cashAfter',
]);
const PCT = new Set(['pctOver', 'targetFirstPct', 'stopFirstPct', 'openAtClosePct', 'greenPct']);
const RATIO = new Set(['rewardRisk', 'targetR', 'avgR', 'minRewardRisk']);
const COUNT = new Set([
  'hits',
  'scanned',
  'universe',
  'items',
  'filings',
  'qty',
  'replays',
  'historyFired',
  'historyWon',
  'historyLost',
  'historyNeither',
  'historySessions',
  'tradesToday',
  'maxTradesPerDay',
]);

/** Every variable the summary strings use, so a missing value reads "–" instead of {{name}}. */
const VARS = [
  'symbol',
  'price',
  'rangeHigh',
  'rangeLow',
  'at',
  'pctOver',
  'hits',
  'scanned',
  'universe',
  'asOf',
  'kind',
  'hours',
  'time',
  'barStart',
  'level',
  'lastClose',
  'distance',
  'entry',
  'stop',
  'target',
  'targetR',
  'riskPerShare',
  'stopRule',
  'replays',
  'seed',
  'targetFirstPct',
  'stopFirstPct',
  'openAtClosePct',
  'maxLossPerTrade',
  'qty',
  'cost',
  'maxLoss',
  'boundBy',
  'maxLossLimit',
  'rewardRisk',
  'verdict',
  'flatBy',
];

/**
 * Text for step cards and panels: summary.code + values through i18n (pipeline:summary.*), with the
 * engine's English inLine / outLine as fallback; check codes through pipeline:checks.*.
 */
export function useStepText() {
  const { t } = useTranslation('pipeline');
  const f = useFormat();

  const check = useCallback(
    (code: string) =>
      t(`checks.${code}`, {
        defaultValue: t('checks.unknown', { code: code.replace(/_/g, ' ') }),
      }),
    [t],
  );

  /** Formatted interpolation values (never undefined: missing values read "–"). */
  const fmtValues = useCallback(
    (step: Step): Record<string, string | number> => {
      const raw: Obj = { ...obj(step.params), ...obj(step.summary?.values) };
      const out: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(raw)) {
        const n = num(v);
        if (PRICE.has(k) && n !== null) out[k] = f.price(n);
        else if (MONEY.has(k) && n !== null) out[k] = f.money(n);
        else if (PCT.has(k) && n !== null) out[k] = f.percent(n);
        else if (RATIO.has(k) && n !== null) out[k] = k === 'targetR' ? f.number(n, 2) : f.price(n);
        else if (COUNT.has(k) && n !== null) out[k] = f.number(n, 0);
        else if ((k === 'time' || k === 'at') && str(v)) out[k] = f.etClock(clock24(v)!);
        else if (typeof v === 'string' || typeof v === 'number') out[k] = v;
      }
      const dist = num(raw.distancePct);
      if (dist !== null) out.distance = f.percent(Math.abs(dist), { fractionDigits: 2 });
      if (str(raw.boundBy))
        out.boundBy = t(`budget.limits.${slug(String(raw.boundBy))}`, {
          defaultValue: String(raw.boundBy),
        });
      if (str(raw.stopRule))
        out.stopRule = t(`exit.stopRules.${raw.stopRule}`, { defaultValue: String(raw.stopRule) });
      if (step.key === 'timemachine' && str(raw.verdict))
        out.verdict = t(`timemachine.verdictShort.${raw.verdict}`, {
          defaultValue: String(raw.verdict),
        });
      if (str(raw.kind))
        out.kind = t(`scanner.kinds.${raw.kind}`, { defaultValue: String(raw.kind) });
      out.reasons = (step.checks ?? []).map(check).join('; ');
      out.count = num(raw.items) ?? 0;
      out.message = str(raw.message) ?? step.error ?? step.summary?.outLine ?? '';
      for (const k of VARS) if (!(k in out)) out[k] = '–';
      return out;
    },
    [f, t, check],
  );

  /** i18n key suffix for the out line (some codes have a variant when a value is missing). */
  const outKey = (step: Step): string | null => {
    const code = step.summary?.code;
    if (!code) return null;
    if (/\.(error|internal_error)$/.test(code)) return 'summary.error';
    const v = obj(step.summary?.values);
    if (code === 'scanner.found' && num(v.price) === null) return 'summary.scanner.found.outNoPick';
    return `summary.${code}.out`;
  };

  const inLine = useCallback(
    (step: Step): string => {
      if (step.status === 'pending' || step.status === 'running' || !step.summary?.code)
        return t(`stepInfo.${step.key}.in`);
      const code = step.summary.code;
      if (/\.(error|internal_error)$/.test(code))
        return step.summary.inLine || t(`stepInfo.${step.key}.in`);
      return t(`summary.${code}.in`, {
        ...fmtValues(step),
        defaultValue: step.summary.inLine || t(`stepInfo.${step.key}.in`),
      });
    },
    [t, fmtValues],
  );

  const outLine = useCallback(
    (step: Step): string => {
      if (step.status === 'pending') return t('card.pendingOut');
      if (step.status === 'running') return t('card.runningOut');
      const key = outKey(step);
      if (!key) return step.summary?.outLine ?? step.error ?? '';
      return t(key, { ...fmtValues(step), defaultValue: step.summary?.outLine ?? '' });
    },

    [t, fmtValues],
  );

  return { check, fmtValues, inLine, outLine };
}
