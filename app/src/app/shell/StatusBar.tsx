import { CircleDot, Clock, FlaskConical, Moon, PlugZap, RotateCw, Sun, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEngineConnection, useStatus } from '@/api';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { AiPanelToggle } from '@/features/ai';
import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useMarketClock } from '@/hooks/useMarketClock';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';

function Divider() {
  return <span aria-hidden className="h-4 w-px bg-border" />;
}

/** Top status bar: market state, New York clock, data delay, engine state, language. */
export function StatusBar() {
  const { t } = useTranslation('shell');
  const f = useFormat();
  const status = useStatus();
  const sse = useEngineConnection((s) => s.sseConnected);
  const clock = useMarketClock();
  const s = status.data;
  const offline = status.isError && !s;
  const stale = status.isError && !!s;

  const delayMin = s ? Math.round(s.dataDelaySeconds / 60) : null;

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-b border-border bg-surface px-4 text-xs text-text-muted"
      aria-label={t('statusBar.label')}
    >
      {/* Market open / closed */}
      {s ? (
        <span className="inline-flex items-center gap-1.5" data-testid="market-state">
          {s.marketOpen ? (
            <Sun className="h-3.5 w-3.5 text-profit" aria-hidden />
          ) : (
            <Moon className="h-3.5 w-3.5 text-text-muted" aria-hidden />
          )}
          <span className="font-semibold text-text">
            {s.marketOpen ? t('market.open') : t('market.closed')}
          </span>
          {s.marketOpen && s.nextClose && (
            <span>
              {t(s.earlyClose ? 'market.closesEarly' : 'market.closesAt', {
                time: f.marketTime(s.nextClose),
              })}
            </span>
          )}
          {!s.marketOpen && s.nextOpen && (
            <span>
              {t('market.opensAt', {
                date: f.marketDate(s.nextOpen),
                time: f.marketTime(s.nextOpen),
              })}
            </span>
          )}
        </span>
      ) : (
        <span>{t('market.unknown')}</span>
      )}

      <Divider />

      {/* New York clock */}
      <SimpleTooltip label={t('clock.tooltip')}>
        <span
          className="tabular inline-flex items-center gap-1.5 text-text"
          data-testid="ny-clock"
          tabIndex={0}
        >
          <Clock className="h-3.5 w-3.5 text-text-muted" aria-hidden />
          <span className="text-text-muted">{t('clock.newYork')}</span>
          <span className="font-medium">{f.marketTime(clock, { seconds: true })}</span>
        </span>
      </SimpleTooltip>

      {delayMin !== null && (
        <>
          <Divider />
          <span className="inline-flex items-center gap-1.5" data-testid="data-delay">
            <span
              aria-hidden
              className={cn('h-1.5 w-1.5 rounded-full', delayMin > 0 ? 'bg-warning' : 'bg-profit')}
            />
            {delayMin > 0 ? t('data.delayed', { minutes: delayMin }) : t('data.realtime')}
          </span>
        </>
      )}

      {s?.mode === 'demo' && (
        <>
          <Divider />
          <SimpleTooltip label={t('demo.tooltip')}>
            <span
              tabIndex={0}
              className="inline-flex items-center gap-1 rounded border border-accent/50 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-text"
            >
              <FlaskConical className="h-3 w-3 text-accent" aria-hidden />
              {t('demo.badge')}
            </span>
          </SimpleTooltip>
        </>
      )}

      <div className="ml-auto flex items-center gap-3">
        {/* Engine status */}
        {offline || stale ? (
          <span
            className="inline-flex items-center gap-2"
            role="status"
            data-testid="engine-status"
          >
            <Unplug className="h-3.5 w-3.5 text-loss" aria-hidden />
            <span className="font-medium text-text">{t('engine.offline')}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={() => void status.refetch()}
              disabled={status.isFetching}
            >
              <RotateCw
                className={cn('!h-3 !w-3', status.isFetching && 'animate-spin')}
                aria-hidden
              />
              {t('engine.retry')}
            </Button>
          </span>
        ) : s ? (
          <SimpleTooltip label={t('engine.tooltip', { version: s.engineVersion })}>
            <span
              className="inline-flex items-center gap-1.5"
              role="status"
              tabIndex={0}
              data-testid="engine-status"
            >
              {sse ? (
                <PlugZap className="h-3.5 w-3.5 text-profit" aria-hidden />
              ) : (
                <CircleDot className="h-3.5 w-3.5 text-warning" aria-hidden />
              )}
              <span>{sse ? t('engine.connected') : t('engine.noEvents')}</span>
            </span>
          </SimpleTooltip>
        ) : (
          <span role="status">{t('engine.connecting')}</span>
        )}
        <AiPanelToggle />
        <Divider />
        <LanguageSwitch />
      </div>
    </header>
  );
}
