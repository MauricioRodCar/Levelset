import { useState, type KeyboardEvent } from 'react';
import {
  BookOpen,
  ChevronRight,
  Copy,
  FileDown,
  Keyboard,
  NotebookPen,
  RotateCw,
  ShieldX,
  Workflow,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useStartRun, type PipelineRun, type Ticket } from '@/api';
import { EarningsBadge } from '@/components/EarningsBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useErrorMessage } from '@/components/useErrorMessage';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';
import { ExportDialog } from './ExportDialog';
import { HowToDialog } from './HowToDialog';
import { InstrumentNote } from './InstrumentNote';
import { PaperLine } from './PaperLine';
import { RecordFillDialog } from './RecordFillDialog';
import { TicketLevels } from './TicketLevels';
import { TicketMenu } from './TicketMenu';
import { ticketText } from './ticketText';
import { useCopyPrice, useCopyText } from './useCopyPrice';
import { MonitorUp } from 'lucide-react';
import { BridgeTicketLine, SendToPlatformDialog } from '@/features/connections/SendToPlatform';
import { AiExplainButton } from '@/features/ai/AiExplainButton';

export interface TicketCardProps {
  ticket: Ticket;
  /** Called after "Stale — re-run" started a new run-all for the ticker. */
  onRunStarted?: (run: PipelineRun) => void;
  className?: string;
}

/**
 * The ticket card (docs/SCREENS.md, ticket card spec).
 * - ready: header, the three levels (largest text, neutral colour), muted secondary line, actions.
 * - stale: same card, muted, with "Stale — re-run".
 * - blocked: collapsed row with the BLOCK badge and the reasons in plain words; expandable.
 * Keyboard on a focused card: 1 / 2 / 3 copy entry / stop loss / take profit, C copies all, F opens the flow.
 */
export function TicketCard({ ticket, onRunStarted, className }: TicketCardProps) {
  if (ticket.status === 'blocked')
    return <BlockedTicketRow ticket={ticket} className={className} />;
  return <ActiveTicketCard ticket={ticket} onRunStarted={onRunStarted} className={className} />;
}

/** Shared ticket title: "BUY 8 TSLA". */
function TicketTitle({ ticket, className }: { ticket: Ticket; className?: string }) {
  const { t } = useTranslation('tickets');
  return (
    <span className={cn('whitespace-nowrap text-base font-semibold text-text', className)}>
      {t(`side.${ticket.side}`)} <span className="tabular">{ticket.qty}</span> {ticket.symbol}
    </span>
  );
}

function OrderMeta({ ticket }: { ticket: Ticket }) {
  const { t } = useTranslation('tickets');
  return (
    <span className="whitespace-nowrap text-xs text-text-muted">
      {t(`orderType.${ticket.orderType}`)}
      {ticket.timeInForce ? ` · ${t(`timeInForce.${ticket.timeInForce}`)}` : ''}
    </span>
  );
}

function useViewFlow(runId: string) {
  const navigate = useNavigate();
  return () => navigate(`/pipeline/${runId}`);
}

function ActiveTicketCard({ ticket, onRunStarted, className }: TicketCardProps) {
  const { t } = useTranslation('tickets');
  const f = useFormat();
  const navigate = useNavigate();
  const copyPrice = useCopyPrice();
  const copyText = useCopyText();
  const viewFlow = useViewFlow(ticket.runId);
  const startRun = useStartRun();
  const errorMessage = useErrorMessage();
  const [dialog, setDialog] = useState<null | 'export' | 'howto' | 'fill' | 'bridge'>(null);
  const stale = ticket.status === 'stale';

  const copyAll = () =>
    void copyText(ticketText(ticket, t), t('copyText.toast', { symbol: ticket.symbol }));

  const rerun = () =>
    startRun.mutate(
      { mode: 'all', ticker: ticket.symbol },
      {
        onSuccess: (run) => {
          toast(t('stale.started', { symbol: ticket.symbol }), {
            action: {
              label: t('actions.viewFlow'),
              onClick: () => navigate(`/pipeline/${run.id}`),
            },
          });
          onRunStarted?.(run);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
    const target = e.target as HTMLElement;
    // Only keys pressed inside the card itself (dialogs are portalled), never while typing.
    if (!e.currentTarget.contains(target)) return;
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return;
    const key = e.key.toLowerCase();
    const actions: Record<string, () => void> = {
      '1': () => void copyPrice(ticket.entry),
      '2': () => void copyPrice(ticket.stop),
      '3': () => void copyPrice(ticket.target),
      c: copyAll,
      f: viewFlow,
    };
    const fn = actions[key];
    if (!fn) return;
    e.preventDefault();
    fn();
  };

  const tm = ticket.timeMachine;
  const title = t('card.label', {
    side: t(`side.${ticket.side}`),
    qty: ticket.qty,
    symbol: ticket.symbol,
  });

  return (
    <article
      tabIndex={0}
      aria-label={title}
      aria-keyshortcuts="1 2 3 C F"
      onKeyDown={onKeyDown}
      data-ticket-id={ticket.id}
      data-status={ticket.status}
      className={cn(
        'rounded-lg border border-border bg-surface p-4 focus-ring',
        stale && 'bg-surface/60',
        className,
      )}
    >
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <TicketTitle ticket={ticket} className={cn(stale && 'text-text-muted')} />
        <OrderMeta ticket={ticket} />
        <EarningsBadge symbol={ticket.symbol} />
        <div className="ml-auto flex items-center gap-2">
          <SimpleTooltip
            label={
              <span className="block space-y-0.5">
                <span className="block font-medium">{t('shortcuts.title')}</span>
                {(['entry', 'stop', 'target', 'all', 'flow'] as const).map((k, i) => (
                  <span key={k} className="block">
                    <kbd className="mr-1.5 inline-block min-w-5 rounded border border-border bg-surface px-1 text-center font-mono">
                      {['1', '2', '3', 'C', 'F'][i]}
                    </kbd>
                    {t(`shortcuts.${k}`)}
                  </span>
                ))}
              </span>
            }
          >
            <span
              tabIndex={0}
              role="img"
              aria-label={t('shortcuts.label')}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-text focus-ring"
            >
              <Keyboard className="h-4 w-4" aria-hidden />
            </span>
          </SimpleTooltip>
          {stale ? (
            <StatusBadge status="stale" size="sm" label={t('stale.badge')} />
          ) : (
            <StatusBadge status="pass" size="sm" label={t('risk.pass')} />
          )}
        </div>
      </header>

      <div className={cn(stale && 'opacity-60')}>
        <TicketLevels entry={ticket.entry} stop={ticket.stop} target={ticket.target} />
      </div>

      <p className="tabular mt-3 flex flex-wrap items-center gap-x-1.5 text-xs text-text-muted">
        <span>{t('secondary.maxLoss', { value: f.money(ticket.maxLoss) })}</span>
        <span aria-hidden>·</span>
        <span>{t('secondary.r', { value: f.number(ticket.rMultiple) })}</span>
        {tm?.verdict && (
          <>
            <span aria-hidden>·</span>
            <SimpleTooltip
              label={t('secondary.oddsDetail', {
                target: f.percent(tm.targetFirstPct ?? 0),
                stop: f.percent(tm.stopFirstPct ?? 0),
                open: f.percent(tm.openAtClosePct ?? 0),
              })}
            >
              <span
                tabIndex={0}
                className="cursor-help rounded underline decoration-dotted underline-offset-2 focus-ring"
              >
                {t('secondary.odds', {
                  verdict: t(`verdict.${tm.verdict}`, { defaultValue: tm.verdict }),
                })}
              </span>
            </SimpleTooltip>
          </>
        )}
        {ticket.flatBy && (
          <span className="ml-auto">
            {t('secondary.flatBy', { time: f.etClock(ticket.flatBy) })}
          </span>
        )}
      </p>

      {ticket.paper && <PaperLine paper={ticket.paper} className="mt-2" />}
      <BridgeTicketLine ticket={ticket} />

      {stale && (
        <p className="mt-2 text-xs text-text-muted">
          {t('stale.reason', { time: f.marketDateTime(ticket.createdAt) })}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {stale ? (
          <Button size="sm" variant="secondary" onClick={rerun} disabled={startRun.isPending}>
            <RotateCw className={cn(startRun.isPending && 'animate-spin')} aria-hidden />
            {t('stale.rerun')}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={copyAll}>
            <Copy aria-hidden />
            {t('actions.copyAll')}
          </Button>
        )}
        {stale && (
          <Button size="sm" variant="outline" onClick={copyAll}>
            <Copy aria-hidden />
            {t('actions.copyAll')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={viewFlow}>
          <Workflow aria-hidden />
          {t('actions.viewFlow')}
        </Button>
        <TicketMenu
          items={[
            {
              key: 'export',
              label: t('menu.export'),
              icon: <FileDown aria-hidden />,
              onSelect: () => setDialog('export'),
            },
            {
              key: 'howto',
              label: t('menu.howto'),
              icon: <BookOpen aria-hidden />,
              onSelect: () => setDialog('howto'),
            },
            {
              key: 'fill',
              label: t('menu.recordFill'),
              icon: <NotebookPen aria-hidden />,
              onSelect: () => setDialog('fill'),
            },
            // v1.1 bridges: only a PASS (ready) ticket; the user confirms with Place in the platform.
            ...(stale
              ? []
              : [
                  {
                    key: 'bridge',
                    label: t('connections:bridges.send.menu'),
                    icon: <MonitorUp aria-hidden />,
                    onSelect: () => setDialog('bridge'),
                  },
                ]),
          ]}
        />
      </div>

      {!stale && <InstrumentNote className="mt-3" />}

      <ExportDialog
        ticket={ticket}
        open={dialog === 'export'}
        onOpenChange={(o) => setDialog(o ? 'export' : null)}
      />
      <HowToDialog
        ticket={ticket}
        open={dialog === 'howto'}
        onOpenChange={(o) => setDialog(o ? 'howto' : null)}
      />
      <RecordFillDialog
        ticket={ticket}
        open={dialog === 'fill'}
        onOpenChange={(o) => setDialog(o ? 'fill' : null)}
      />
      {!stale && (
        <SendToPlatformDialog
          ticket={ticket}
          open={dialog === 'bridge'}
          onOpenChange={(o) => setDialog(o ? 'bridge' : null)}
        />
      )}
    </article>
  );
}

/** Blocked ticket: one collapsed row with the BLOCK badge and the reasons; expands to the detail. */
function BlockedTicketRow({ ticket, className }: { ticket: Ticket; className?: string }) {
  const { t } = useTranslation('tickets');
  const f = useFormat();
  const viewFlow = useViewFlow(ticket.runId);
  const [open, setOpen] = useState(false);
  const reasons = (ticket.riskReasons ?? []).map((code) =>
    t(`riskReasons.${code}`, { defaultValue: t('riskReasons.unknown', { code }) }),
  );
  const detailId = `blocked-${ticket.id}`;

  return (
    <article
      aria-label={t('card.labelBlocked', {
        side: t(`side.${ticket.side}`),
        qty: ticket.qty,
        symbol: ticket.symbol,
      })}
      data-ticket-id={ticket.id}
      data-status="blocked"
      className={cn('rounded-lg border border-border bg-surface', className)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
        className="block w-full rounded-lg px-4 py-3 text-left focus-ring"
      >
        <span className="flex items-center gap-3">
          <ChevronRight
            className={cn(
              'h-4 w-4 shrink-0 text-text-muted transition-transform',
              open && 'rotate-90',
            )}
            aria-hidden
          />
          <TicketTitle ticket={ticket} className="text-sm text-text-muted" />
          <StatusBadge status="block" size="sm" label={t('risk.block')} />
          <span className="ml-auto shrink-0 text-xs text-text-muted">
            {open ? t('blocked.hide') : t('blocked.show')}
          </span>
        </span>
        <span className="mt-1 block pl-7 text-sm text-text" data-testid="blocked-reasons">
          {reasons.join(' · ') || t('blocked.noReason')}
        </span>
      </button>
      {open && (
        <div id={detailId} className="space-y-3 border-t border-border px-4 py-3">
          <AiExplainButton kind="blocked_ticket" ticketId={ticket.id} />
          <ul className="space-y-1">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text">
                <ShieldX className="mt-0.5 h-4 w-4 shrink-0 text-loss" aria-hidden />
                {r}
              </li>
            ))}
          </ul>
          {!!ticket.riskDetail?.length && (
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted">{t('blocked.detail')}</p>
              <ul className="space-y-0.5 rounded-md bg-surface2 px-3 py-2 font-mono text-xs text-text">
                {ticket.riskDetail.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="tabular text-xs text-text-muted">
            {t('levels.entry')} {f.price(ticket.entry)} · {t('levels.stop')} {f.price(ticket.stop)}{' '}
            · {t('levels.target')} {f.price(ticket.target)} ·{' '}
            {t('secondary.maxLoss', { value: f.money(ticket.maxLoss) })}
          </p>
          {ticket.paper && <PaperLine paper={ticket.paper} />}
          <Button size="sm" variant="outline" onClick={viewFlow}>
            <Workflow aria-hidden />
            {t('actions.viewFlow')}
          </Button>
        </div>
      )}
    </article>
  );
}
