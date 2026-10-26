import { useEffect, useId, useState, type FormEvent } from 'react';
import { KeyRound, Loader2, Monitor, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Switch } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import {
  useAiSettings,
  useAiStatus,
  useRefreshAiStatus,
  useUpdateAiSettings,
  type AiModel,
  type AiSettingsUpdate,
} from '@/api';
import { useFormat } from '@/i18n/useFormat';
import { CLAUDE_KEY_NAME, deleteSecret, hasSecret, secretsAvailable, setSecret } from './secrets';
import { validateApiKey, type ApiKeyError } from './validation';

/** Settings > AI (optional): off by default. Engine-side settings (on/off, model, monthly cap,
 * spend) plus the BYO Claude API key, kept in Windows Credential Manager by the Tauri shell,
 * which pushes it to the engine. The UI can never read the key back. */
export function AiTab() {
  const { t } = useTranslation('settings');
  const { t: ta } = useTranslation('ai');
  const uid = useId();
  const desktop = secretsAvailable();
  const f = useFormat();
  const settings = useAiSettings();
  const status = useAiStatus();
  const update = useUpdateAiSettings();
  const refreshStatus = useRefreshAiStatus();
  const [cap, setCap] = useState('');
  const [capError, setCapError] = useState(false);
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

  useEffect(() => {
    if (settings.data) setCap(String(settings.data.monthlyCapUsd));
  }, [settings.data]);

  const patch = (body: AiSettingsUpdate) =>
    update.mutate(body, {
      onSuccess: () => toast(ta('settings.saved')),
      onError: () => toast.error(ta('settings.saveFailed')),
    });

  const onCapSave = (e: FormEvent) => {
    e.preventDefault();
    const v = Number(cap.replace(',', '.'));
    const bad = cap.trim() === '' || !Number.isFinite(v) || v < 0 || v > 1000;
    setCapError(bad);
    if (!bad) patch({ monthlyCapUsd: Math.round(v * 100) / 100 });
  };

  /** The shell pushes the key to the engine in the background; re-read status shortly after. */
  const afterKeyChange = () => window.setTimeout(refreshStatus, 1500);

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
      afterKeyChange();
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
      afterKeyChange();
      toast(t('ai.key.removedToast'));
    } catch {
      toast.error(t('ai.key.removeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const fieldId = `${uid}-key`;

  return (
    <div className="grid max-w-6xl gap-5 lg:grid-cols-2 xl:grid-cols-3">
      <Card title={t('ai.title')} subtitle={t('ai.description')}>
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface2 px-3 py-2.5">
            <div>
              <Label htmlFor={`${uid}-enabled`}>{ta('settings.enable')}</Label>
              <p className="text-xs text-text-muted">{ta('settings.enableHint')}</p>
            </div>
            <Switch
              id={`${uid}-enabled`}
              checked={settings.data?.enabled ?? false}
              disabled={!settings.data || update.isPending}
              onCheckedChange={(v) => patch({ enabled: v })}
            />
          </div>
          <div className="space-y-1.5">
            <p className="font-medium text-text">{ta('settings.whatTitle')}</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-text-muted">
              <li>{ta('settings.what.explain')}</li>
              <li>{ta('settings.what.coach')}</li>
              <li>{ta('settings.what.chat')}</li>
            </ul>
            <p className="text-xs text-text">{ta('settings.never')}</p>
            <p className="text-xs text-text-muted">{ta('settings.notNeeded')}</p>
            <p className="text-xs text-text-muted">{ta('settings.billing')}</p>
          </div>
        </div>
      </Card>

      <Card title={ta('settings.usageTitle')} subtitle={ta('settings.usageSubtitle')}>
        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-model`}>{ta('settings.model')}</Label>
            <Select
              id={`${uid}-model`}
              value={settings.data?.model ?? 'sonnet'}
              disabled={!settings.data || update.isPending}
              onChange={(e) => patch({ model: e.target.value as AiModel })}
            >
              {(['haiku', 'sonnet', 'opus'] as const).map((m) => (
                <option key={m} value={m}>
                  {ta(`settings.models.${m}`)}
                </option>
              ))}
            </Select>
          </div>
          <form onSubmit={onCapSave} noValidate className="space-y-1.5">
            <Label htmlFor={`${uid}-cap`}>{ta('settings.cap')}</Label>
            <div className="flex gap-2">
              <Input
                id={`${uid}-cap`}
                inputMode="decimal"
                className="tabular max-w-[10rem]"
                value={cap}
                disabled={!settings.data}
                onChange={(e) => setCap(e.target.value)}
                aria-invalid={capError ? true : undefined}
                aria-describedby={`${uid}-cap-hint`}
              />
              <Button type="submit" disabled={!settings.data || update.isPending}>
                {ta('settings.save')}
              </Button>
            </div>
            <p id={`${uid}-cap-hint`} className="text-xs text-text-muted">
              {capError ? ta('settings.capInvalid') : ta('settings.capHint')}
            </p>
          </form>
          {status.data && (
            <div className="rounded-md border border-border bg-surface2 px-3 py-2.5" data-testid="ai-spend">
              <p className="text-xs text-text-muted">{ta('settings.spent')}</p>
              <p className="tabular text-text">
                {ta('settings.spentValue', {
                  spent: f.money(status.data.spentThisMonthUsd),
                  cap: f.money(status.data.monthlyCapUsd),
                })}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {status.data.keyPresent
                  ? ta('settings.engineKey.present')
                  : ta('settings.engineKey.missing')}
              </p>
            </div>
          )}
          {!desktop && <p className="text-xs text-text-muted">{ta('settings.demoNote')}</p>}
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
