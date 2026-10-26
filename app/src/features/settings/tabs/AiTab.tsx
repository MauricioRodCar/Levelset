import { useEffect, useId, useState, type FormEvent } from 'react';
import { KeyRound, Loader2, Monitor, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/ui/button';
import { Input, Label, Switch } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { prefs } from '@/lib/prefs';
import { CLAUDE_KEY_NAME, deleteSecret, hasSecret, secretsAvailable, setSecret } from './secrets';
import { validateApiKey, type ApiKeyError } from './validation';

/** Local pref (not a secret): whether the user wants the optional AI summaries. */
const AI_ENABLED_PREF = 'ai.enabled';

/** Settings > AI (optional): off by default; BYO Claude API key kept in Windows Credential Manager. */
export function AiTab() {
  const { t } = useTranslation('settings');
  const uid = useId();
  const desktop = secretsAvailable();
  const [enabled, setEnabled] = useState(() => prefs.get<boolean>(AI_ENABLED_PREF, false));
  const [saved, setSaved] = useState<boolean | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState<ApiKeyError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    hasSecret(CLAUDE_KEY_NAME)
      .then((v) => alive && setSaved(v))
      .catch(() => alive && setSaved(false));
    return () => {
      alive = false;
    };
  }, [desktop]);

  const toggle = (v: boolean) => {
    setEnabled(v);
    prefs.set(AI_ENABLED_PREF, v);
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const err = validateApiKey(key);
    setError(err);
    if (err) return;
    setBusy(true);
    try {
      await setSecret(CLAUDE_KEY_NAME, key.trim());
      setKey(''); // never keep the key in memory or show it back
      setSaved(true);
      toast(t('ai.key.savedToast'));
    } catch {
      toast.error(t('ai.key.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await deleteSecret(CLAUDE_KEY_NAME);
      setSaved(false);
      toast(t('ai.key.removedToast'));
    } catch {
      toast.error(t('ai.key.removeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const fieldId = `${uid}-key`;

  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
      <Card title={t('ai.title')} subtitle={t('ai.description')}>
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface2 px-3 py-2.5">
            <div>
              <Label htmlFor={`${uid}-enabled`}>{t('ai.enable')}</Label>
              <p className="text-xs text-text-muted">{t('ai.enableHint')}</p>
            </div>
            <Switch id={`${uid}-enabled`} checked={enabled} onCheckedChange={toggle} />
          </div>
          <div className="space-y-1.5">
            <p className="font-medium text-text">{t('ai.whatTitle')}</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-text-muted">
              <li>{t('ai.what.earnings')}</li>
              <li>{t('ai.what.news')}</li>
              <li>{t('ai.what.filings')}</li>
            </ul>
            <p className="text-xs text-text-muted">{t('ai.notNeeded')}</p>
            <p className="text-xs text-text-muted">{t('ai.cost')}</p>
          </div>
        </div>
      </Card>

      <Card title={t('ai.key.title')} subtitle={t('ai.key.subtitle')}>
        {!desktop ? (
          <div className="flex items-start gap-3 rounded-md border border-border bg-surface2 px-3 py-2.5 text-sm">
            <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
            <p className="text-text" data-testid="ai-desktop-only">
              {t('ai.key.desktopOnly')}
            </p>
          </div>
        ) : saved ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-text">
              <ShieldCheck className="h-4 w-4 text-profit" aria-hidden />
              <span>{t('ai.key.saved')}</span>
            </div>
            <p className="text-xs text-text-muted">{t('ai.key.savedHint')}</p>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void onRemove()}>
              <Trash2 aria-hidden />
              {t('ai.key.remove')}
            </Button>
          </div>
        ) : (
          <form onSubmit={onSave} noValidate className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={fieldId}>{t('ai.key.field')}</Label>
              <Input
                id={fieldId}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                disabled={saved === null}
                placeholder="sk-ant-…"
                onChange={(e) => setKey(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${fieldId}-err` : `${fieldId}-hint`}
              />
              {error ? (
                <p id={`${fieldId}-err`} className="text-xs text-text">
                  <span
                    aria-hidden
                    className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-loss align-middle"
                  />
                  {t(`ai.key.errors.${error}`)}
                </p>
              ) : (
                <p id={`${fieldId}-hint`} className="text-xs text-text-muted">
                  {t('ai.key.hint')}
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={busy || saved === null}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
                {t('ai.key.save')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
