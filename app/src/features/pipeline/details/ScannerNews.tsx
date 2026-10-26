import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FileText, Newspaper, Search } from 'lucide-react';
import type { PipelineRun, Step } from '@/api';
import { EmptyState } from '@/components/EmptyState';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';
import { arr, clock24, num, obj, str } from '../model';
import { Stat, StatRow } from './common';

export function ScannerDetail({ step, run }: { step: Step; run: PipelineRun }) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const [filter, setFilter] = useState('');
  const o = obj(step.outputs);
  const hits = arr(o.hits);
  const rows = useMemo(() => {
    const q = filter.trim().toUpperCase();
    return hits
      .filter((h) => !q || String(h.symbol ?? '').includes(q))
      .sort((a, b) => (num(b.pct_over) ?? 0) - (num(a.pct_over) ?? 0));
  }, [hits, filter]);
  const picked = run.ticker;
  return (
    <div>
      <StatRow>
        <Stat label={t('scanner.universe')} value={f.number(num(o.universe) ?? 0, 0)} />
        <Stat label={t('scanner.scanned')} value={f.number(num(o.scanned) ?? 0, 0)} />
        <Stat label={t('scanner.hits')} value={f.number(hits.length, 0)} />
        <Stat
          label={t('scanner.picked')}
          value={picked ?? '—'}
          hint={str(o.as_of) ? t('scanner.asOf', { value: str(o.as_of) }) : undefined}
        />
      </StatRow>
      {hits.length === 0 ? (
        <EmptyState icon={Search} title={t('scanner.noHits')} className="py-6" />
      ) : (
        <>
          <label className="mt-3 flex max-w-xs items-center gap-2 rounded-md border border-border bg-surface2 px-2 focus-within:ring-1 focus-within:ring-accent">
            <Search className="h-4 w-4 text-text-muted" aria-hidden />
            <span className="sr-only">{t('scanner.filter')}</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('scanner.filter')}
              className="h-8 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
            />
          </label>
          <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface2 text-xs text-text-muted">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">{t('scanner.col.symbol')}</th>
                  <th className="px-3 py-1.5 text-left font-medium">{t('scanner.col.setup')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('scanner.col.price')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('scanner.col.range')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('scanner.col.over')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('scanner.col.at')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const sym = String(h.symbol ?? '');
                  const isPick = sym === picked;
                  const lo = num(h.or_low);
                  const hi = num(h.or_high);
                  const at = clock24(h.at);
                  return (
                    <tr
                      key={sym}
                      className={cn('border-t border-border', isPick && 'bg-primary/10')}
                      aria-current={isPick || undefined}
                    >
                      <td className="px-3 py-1.5 font-medium text-text">
                        {sym}
                        {isPick && (
                          <span className="ml-2 rounded border border-primary/50 px-1 text-[11px] text-text">
                            {t('scanner.pickedBadge')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-text-muted">
                        {arr<string>(h.setups)
                          .map((s) => t(`scanner.setups.${s}`, { defaultValue: s }))
                          .join(', ')}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">
                        {num(h.price) !== null ? f.price(num(h.price)!) : '—'}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right text-text-muted">
                        {lo !== null && hi !== null ? `${f.price(lo)} – ${f.price(hi)}` : '—'}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">
                        {num(h.pct_over) !== null
                          ? f.percent(num(h.pct_over)!, { signed: true, fractionDigits: 2 })
                          : '—'}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right text-text-muted">
                        {at ? f.etClock(at) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** trader-news tags -> the contract's tag set (people -> leadership, capital/risk -> other). */
const TAG_MAP: Record<string, string> = { people: 'leadership', capital: 'other', risk: 'other' };

export function NewsDetail({ step }: { step: Step }) {
  const { t } = useTranslation('pipeline');
  const f = useFormat();
  const items = arr(obj(step.outputs).items);
  if (!items.length)
    return (
      <EmptyState
        icon={Newspaper}
        title={t('news.none')}
        description={step.status === 'check' ? (step.summary?.outLine ?? undefined) : undefined}
        className="py-6"
      />
    );
  return (
    <ul className="max-h-80 divide-y divide-border overflow-auto rounded-md border border-border">
      {items.map((it, i) => {
        const tags = [...new Set(arr<string>(it.tags).map((x) => TAG_MAP[x] ?? x))];
        const filing = it.kind === 'filing';
        const Icon = filing ? FileText : Newspaper;
        const link = str(it.link);
        const time = str(it.time);
        return (
          <li key={String(it.id ?? i)} className="flex gap-3 px-3 py-2">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                {time && <span className="tabular">{f.marketDateTime(time)}</span>}
                <span>{str(it.source) ?? (filing ? 'SEC' : 'Yahoo')}</span>
                {filing && <span>{t('news.filing')}</span>}
                {it.important === true && (
                  <span className="rounded border border-warning/50 px-1 text-text">
                    {t('news.important')}
                  </span>
                )}
              </div>
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group inline-flex items-start gap-1 text-sm text-text hover:underline focus-ring"
                  lang="en"
                >
                  {String(it.title ?? '')}
                  <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-text-muted" aria-hidden />
                </a>
              ) : (
                <p className="text-sm text-text" lang="en">
                  {String(it.title ?? '')}
                </p>
              )}
              {tags.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <li
                      key={tag}
                      className={cn(
                        'rounded border px-1.5 text-[11px] text-text',
                        tag === 'earnings' || tag === 'halt'
                          ? 'border-warning/50'
                          : 'border-border',
                      )}
                    >
                      {t(`news.tags.${tag}`, { defaultValue: tag })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
