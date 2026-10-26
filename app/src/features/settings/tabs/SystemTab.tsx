import { useEffect, useId, useState, type ReactNode } from 'react';
import { FlaskConical, Loader2, MonitorCog, Power, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStatus } from '@/api';
import { Card } from '@/components/Card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import {
  getSystemPrefs,
  setAutostart,
  setDemoMode,
  setKeepAwake,
  shellAvailable,
  type SystemPrefs,
} from '@/lib/shell';

/**
 * Settings > System (desktop shell only): Start with Windows, keep the PC awake during market
 * hours, and the demo-mode toggle (writes / removes the demo marker and restarts Levelset).
 * In the browser / web demo every control is shown disabled with a note.
 */
export function SystemTab() {
  const { t } = useTranslation('settings');
  const status = useStatus();
  const desktop = shellAvailable();
  const [prefs, setPrefs] = useState<SystemPrefs | null>(null);
  const [busy, setBusy] = useState<null | 'autostart' | 'keepAwake'>(null);
  const [confirm, setConfirm] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    getSystemPrefs()
      .then(setPrefs)
      .catch((e) => toast.error(t('system.loadFailed', { detail: String(e) })));
  }, [desktop, t]);

  const demoActive = prefs?.demoActive ?? status.data?.mode === 'demo';

  const toggle = async (which: 'autostart' | 'keepAwake', on: boolean) => {
    setBusy(which);
    try {
      setPrefs(await (which === 'autostart' ? setAutostart(on) : setKeepAwake(on)));
    } catch (e) {
      toast.error(t('system.saveFailed', { detail: String(e) }));
    } finally {
      setBusy(null);
    }
  };

  const restart = async () => {
    setRestarting(true);
    try {
      await setDemoMode(!demoActive);
    } catch (e) {
      setRestarting(false);
      toast.error(t('system.demo.failed', { detail: String(e) }));
    }
  };

  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-2" data-testid="system-tab">
      {!desktop && (
        <p
          className="rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-text-muted lg:col-span-2"
          data-testid="system-web-note"
        >
          {t('system.webNote')}
        </p>
      )}
      <Card title={t('system.background.title')} subtitle={t('system.background.subtitle')}>
        <div className="space-y-4">
          <ToggleRow
            icon={<Power className="h-4 w-4 text-text-muted" aria-hidden />}
            label={t('system.autostart.label')}
            hint={t('system.autostart.hint')}
            checked={prefs?.autostart ?? false}
            disabled={!desktop || !prefs || busy !== null}
            busy={busy === 'autostart'}
            onChange={(v) => void toggle('autostart', v)}
          />
          <ToggleRow
            icon={<Sun className="h-4 w-4 text-text-muted" aria-hidden />}
            label={t('system.keepAwake.label')}
            hint={t('system.keepAwake.hint')}
            checked={prefs?.keepAwake ?? false}
            disabled={!desktop || !prefs || busy !== null}
            busy={busy === 'keepAwake'}
            onChange={(v) => void toggle('keepAwake', v)}
          />
          <p className="flex gap-2 text-xs text-text-muted">
            <MonitorCog className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t('system.tray')}
          </p>
        </div>
      </Card>

      <Card title={t('system.demo.title')} subtitle={t('system.demo.subtitle')}>
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <div className="flex-1 space-y-2 text-sm">
            <p className="font-medium text-text" data-testid="system-demo-state">
              {demoActive ? t('system.demo.on') : t('system.demo.off')}
            </p>
            <p className="text-xs text-text-muted">{t('system.demo.explain')}</p>
            {prefs?.demoEnv && <p className="text-xs text-text">{t('system.demo.env')}</p>}
            <Button
              size="sm"
              variant="outline"
              disabled={!desktop || !prefs || prefs.demoEnv || restarting}
              onClick={() => setConfirm(true)}
            >
              {demoActive ? t('system.demo.turnOff') : t('system.demo.turnOn')}
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={confirm} onOpenChange={(o) => !restarting && setConfirm(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {demoActive ? t('system.demo.confirmOffTitle') : t('system.demo.confirmOnTitle')}
            </DialogTitle>
            <DialogDescription>{t('system.demo.confirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={restarting}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void restart()} disabled={restarting}>
              {restarting && <Loader2 className="animate-spin" aria-hidden />}
              {t('system.demo.restart')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  checked,
  disabled,
  busy,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  busy: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-describedby={`${id}-hint`}
        className="mt-0.5"
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-text">
          {icon}
          {label}
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        </label>
        <p id={`${id}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      </div>
    </div>
  );
}
