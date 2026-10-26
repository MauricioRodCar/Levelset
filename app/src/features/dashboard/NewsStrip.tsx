import { ExternalLink, FileText, Newspaper } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNews } from '@/api';
import { Card } from '@/components/Card';
import { AiExplainButton } from '@/features/ai';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { useFormat } from '@/i18n/useFormat';

const MAX_ITEMS = 6;

/** Headlines and 8-Ks for the watchlist tickers, newest first, with translated tags. */
export function NewsStrip({ tickers }: { tickers: string[] }) {
  const { t } = useTranslation('dashboard');
  const f = useFormat();
  const q = useNews(tickers, 12, { refetchInterval: 120_000 });

  return (
    <Card title={t('news.title')} subtitle={t('news.subtitle')} flush aria-label={t('news.title')}>
      {tickers.length > 0 && (
        <AiExplainButton kind="news_summary" tickers={tickers} hours={12} className="px-4 pb-3" />
      )}
      {!tickers.length ? (
        <p className="px-4 pb-4 text-sm text-text-muted">{t('news.noWatchlist')}</p>
      ) : q.isLoading ? (
        <div className="space-y-2 px-4 pb-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <div className="px-4 pb-4">
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !q.data?.length ? (
        <p className="px-4 pb-4 text-sm text-text-muted">{t('news.empty')}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {q.data.slice(0, MAX_ITEMS).map((n) => {
            const SourceIcon = n.source === 'sec' ? FileText : Newspaper;
            return (
              <li key={n.id} className="px-4 py-2.5" data-testid="news-item">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span className="tabular whitespace-nowrap">{f.marketTime(n.publishedAt)}</span>
                  <span className="font-semibold text-text">{n.symbol}</span>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <SourceIcon className="h-3 w-3" aria-hidden />
                    {t(`news.source.${n.source}`)}
                  </span>
                  <span className="ml-auto flex flex-wrap justify-end gap-1">
                    {(n.tags ?? []).map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-border bg-surface2 px-1.5 py-px text-[11px] text-text-muted"
                      >
                        {t(`news.tags.${tag}`, { defaultValue: tag })}
                      </span>
                    ))}
                  </span>
                </div>
                {n.url ? (
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group mt-0.5 flex items-start gap-1 rounded text-sm text-text hover:text-accent focus-ring"
                  >
                    <span className="line-clamp-2">{n.title}</span>
                    <ExternalLink
                      className="mt-1 h-3 w-3 shrink-0 text-text-muted opacity-0 group-hover:opacity-100"
                      aria-hidden
                    />
                  </a>
                ) : (
                  <p className="mt-0.5 line-clamp-2 text-sm text-text">{n.title}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
