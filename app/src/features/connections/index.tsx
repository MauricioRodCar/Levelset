import { useState } from 'react';
import { ChevronDown, Copy, Lock, PlugZap, ShieldCheck, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { PlatformHowTo } from '@/components/ticket/PlatformHowTo';
import { InstrumentNote } from '@/components/ticket/InstrumentNote';
import { PLATFORMS, type PlatformInfo } from '@/components/ticket/platforms';
import { cn } from '@/lib/utils';
import { BridgesSection } from './BridgesSection';

/**
 * Connections (docs/SCREENS.md S5). Levelset has no broker link and never sends orders: every platform card
 * offers copy / export plus a step-by-step guide. v1.1 adds the in-platform bridges (cTrader cBot,
 * MT4/MT5 EAs) that show a ticket on the chart for the user to Place or Dismiss there.
 * Direct APIs (Pro) are labelled only.
 */
export default function ConnectionsPage() {
  const { t } = useTranslation('connections');
  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      <div
        role="note"
        className="mb-5 flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3"
      >
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="text-sm">
          <p className="font-medium text-text">{t('noOrders.title')}</p>
          <p className="text-text-muted">{t('noOrders.body')}</p>
        </div>
        <Link
          to="/"
          className="ml-auto shrink-0 self-center rounded text-sm text-accent hover:underline focus-ring"
        >
          {t('card.goToTickets')}
        </Link>
      </div>
      <BridgesSection />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        {PLATFORMS.map((p) => (
          <PlatformCard key={p.id} platform={p} />
        ))}
      </div>
      <InstrumentNote className="mt-5" />
    </div>
  );
}

function PlatformCard({ platform }: { platform: PlatformInfo }) {
  const { t } = useTranslation('connections');
  const { t: tt } = useTranslation('tickets');
  const [open, setOpen] = useState(false);
  const id = platform.id;
  const stepsId = `howto-${id}`;
  const bridge = platform.later === 'bridge';
  return (
    <section
      aria-labelledby={`platform-${id}`}
      className="rounded-lg border border-border bg-surface"
      data-testid={`platform-${id}`}
    >
      <header className="flex items-start gap-3 px-4 pt-4">
        <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" aria-hidden />
        <div className="min-w-0">
          <h2 id={`platform-${id}`} className="text-base font-semibold text-text">
            {t(`platforms.${id}.name`)}
          </h2>
          <p className="text-xs text-text-muted">{t(`platforms.${id}.kind`)}</p>
        </div>
      </header>
      <ul className="mt-3 space-y-2 px-4 text-sm">
        <li className="flex items-center gap-2">
          <Copy className="h-4 w-4 shrink-0 text-profit" aria-hidden />
          <span className="text-text">
            {t('card.tickets')}: {t('card.copyExport')}
          </span>
          <span className="ml-auto rounded-full border border-profit/40 bg-profit/10 px-2 py-0.5 text-xs font-medium text-text">
            {t('card.available')}
          </span>
        </li>
        <li className="flex items-start gap-2">
          {bridge ? (
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-profit" aria-hidden />
          ) : (
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
          )}
          <div className="min-w-0">
            <span className={bridge ? 'text-text' : 'text-text-muted'}>
              {bridge ? t('card.bridge') : t('card.api')}
            </span>
            <p className="text-xs text-text-muted">
              {bridge ? `${t('card.bridgeHint')} ${t('card.setUpBridge')}` : t('card.apiHint')}
            </p>
          </div>
          {bridge ? (
            <span className="ml-auto shrink-0 rounded-full border border-profit/40 bg-profit/10 px-2 py-0.5 text-xs font-medium text-text">
              {t('card.bridgeAvailable')}
            </span>
          ) : (
            <span className="ml-auto shrink-0 rounded-full border border-border bg-surface2 px-2 py-0.5 text-xs font-medium text-text-muted">
              {t('card.pro')}
            </span>
          )}
        </li>
        <li className="text-xs text-text-muted">
          {t('card.exportFormat', { format: tt(`export.formats.${platform.exportFormat}`) })}
        </li>
      </ul>
      <div className="mt-3 border-t border-border">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={stepsId}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-b-lg px-4 py-2.5 text-left text-sm font-medium text-text hover:bg-surface2 focus-ring"
        >
          {open ? t('card.hideSteps') : t('card.showSteps')}
          <ChevronDown
            className={cn(
              'ml-auto h-4 w-4 text-text-muted transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
        {open && (
          <div id={stepsId} className="px-4 pb-4">
            <PlatformHowTo platform={id} />
          </div>
        )}
      </div>
    </section>
  );
}
