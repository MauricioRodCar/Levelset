import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Loader2, MessageSquarePlus, Send, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAiChat, useAiStatus } from '@/api';
import { ErrorState } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AiAnswerView } from './AiAnswerView';
import { useAiLang } from './lang';
import { toMessages, useAiPanel } from './store';

const EXAMPLES = ['winRate', 'blocked', 'stop'] as const;

/** Status-bar button that opens / closes the chat panel. Hidden while AI is off. */
export function AiPanelToggle() {
  const { t } = useTranslation('ai');
  const status = useAiStatus();
  const open = useAiPanel((s) => s.open);
  const toggle = useAiPanel((s) => s.toggle);
  if (!status.data?.enabled) return null;
  return (
    <SimpleTooltip label={t('panel.toggleTooltip')}>
      <Button
        size="sm"
        variant={open ? 'secondary' : 'ghost'}
        className="h-6 px-2 text-xs"
        aria-pressed={open}
        aria-label={open ? t('panel.close') : t('panel.open')}
        onClick={toggle}
        data-testid="ai-toggle"
      >
        <Sparkles className="!h-3.5 !w-3.5 text-accent" aria-hidden />
        {t('panel.toggle')}
      </Button>
    </SimpleTooltip>
  );
}

/** Layer 3: side-panel chat scoped to Levelset data. Mounted by the shell; renders when open. */
export function AiChatPanel() {
  const { t } = useTranslation('ai');
  const uid = useId();
  const lang = useAiLang();
  const status = useAiStatus();
  const { open, turns, push, clear, setOpen } = useAiPanel();
  const chat = useAiChat();
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [turns.length, chat.isPending]);

  if (!open || !status.data?.enabled) return null;
  const s = status.data;

  const send = (text: string) => {
    const content = text.trim().slice(0, 8000);
    if (!content || chat.isPending || !s.ready) return;
    const history = [...turns, { role: 'user' as const, content }];
    push({ role: 'user', content });
    setDraft('');
    chat.mutate(
      { lang, messages: toMessages(history) },
      { onSuccess: (answer) => push({ role: 'assistant', answer }) },
    );
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  return (
    <aside
      aria-label={t('panel.title')}
      data-testid="ai-panel"
      className="flex w-[380px] shrink-0 flex-col border-l border-border bg-surface"
    >
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden />
            {t('panel.title')}
          </h2>
          <p className="text-xs text-text-muted">{t('panel.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1">
          <SimpleTooltip label={t('panel.clear')}>
            <Button size="icon-sm" variant="ghost" aria-label={t('panel.clear')} onClick={clear}>
              <MessageSquarePlus aria-hidden />
            </Button>
          </SimpleTooltip>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('panel.close')}
            onClick={() => setOpen(false)}
          >
            <X aria-hidden />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {!turns.length && (
          <div className="space-y-3 text-sm">
            <p className="text-text-muted">{t('panel.empty')}</p>
            <p className="text-xs font-medium text-text-muted">{t('panel.examplesTitle')}</p>
            <ul className="space-y-1.5">
              {EXAMPLES.map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    disabled={!s.ready}
                    onClick={() => send(t(`panel.examples.${k}`))}
                    className="w-full rounded-md border border-border bg-surface2 px-3 py-2 text-left text-xs text-text hover:border-primary focus-ring disabled:opacity-50"
                  >
                    {t(`panel.examples.${k}`)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className="ml-8 rounded-md bg-primary/10 px-3 py-2 text-sm text-text">
              <span className="sr-only">{t('panel.you')}: </span>
              {turn.content}
            </div>
          ) : (
            <div key={i} className="rounded-md border border-border bg-surface2 px-3 py-2.5">
              <span className="sr-only">{t('panel.assistant')}: </span>
              <AiAnswerView answer={turn.answer} compact />
            </div>
          ),
        )}
        {chat.isPending && (
          <p className="inline-flex items-center gap-2 text-xs text-text-muted" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {t('panel.thinking')}
          </p>
        )}
        {chat.error && !chat.isPending && <ErrorState compact error={chat.error} />}
        <div ref={end} />
      </div>

      <form onSubmit={onSubmit} className="space-y-2 border-t border-border px-4 py-3">
        {!s.ready && s.reason && (
          <p className="text-xs text-text-muted">
            {t(`notReady.${s.reason}`)}{' '}
            <Link to="/settings/ai" className="text-accent underline-offset-4 hover:underline">
              {t('notReady.openSettings')}
            </Link>
          </p>
        )}
        <label htmlFor={`${uid}-msg`} className="sr-only">
          {t('panel.inputLabel')}
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={`${uid}-msg`}
            rows={2}
            maxLength={8000}
            value={draft}
            disabled={!s.ready}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('panel.placeholder')}
            className={cn(
              'min-h-[2.5rem] flex-1 resize-none rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text focus-ring',
              'placeholder:text-text-muted disabled:opacity-50',
            )}
          />
          <Button
            type="submit"
            size="icon"
            variant="primary"
            aria-label={t('panel.send')}
            disabled={!s.ready || chat.isPending || !draft.trim()}
          >
            <Send aria-hidden />
          </Button>
        </div>
      </form>
    </aside>
  );
}
