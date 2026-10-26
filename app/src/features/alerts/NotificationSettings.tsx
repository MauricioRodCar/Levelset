import { useId, useState } from 'react';
import { BellRing, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/ui/button';
import { Label, Switch } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { isTauri } from '@/lib/env';
import { getAlertPrefs, setAlertPref, type AlertPrefs } from './alertPrefs';
import { deliver, ensureNotificationPermission, playChime } from './notifications';

/** Windows notifications on/off and sound on/off (local prefs). */
export function NotificationSettings() {
  const { t } = useTranslation('alerts');
  const uid = useId();
  const [opts, setOpts] = useState<AlertPrefs>(getAlertPrefs);
  const desktopApp = isTauri();

  const change = async (key: keyof AlertPrefs, value: boolean) => {
    setAlertPref(key, value);
    setOpts((o) => ({ ...o, [key]: value }));
    if (key === 'desktop' && value && desktopApp) {
      const ok = await ensureNotificationPermission(true);
      if (!ok) toast.error(t('notifications.denied'));
    }
    if (key === 'sound' && value) playChime();
  };

  return (
    <Card title={t('notifications.title')} subtitle={t('notifications.subtitle')}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface2 px-3 py-2.5">
          <div className="flex items-start gap-3">
            <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <div>
              <Label htmlFor={`${uid}-desktop`}>{t('notifications.desktop')}</Label>
              <p className="text-xs text-text-muted">
                {desktopApp ? t('notifications.desktopHint') : t('notifications.browserHint')}
              </p>
            </div>
          </div>
          <Switch
            id={`${uid}-desktop`}
            checked={opts.desktop}
            disabled={!desktopApp}
            onCheckedChange={(v) => void change('desktop', v)}
          />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface2 px-3 py-2.5">
          <div className="flex items-start gap-3">
            <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <div>
              <Label htmlFor={`${uid}-sound`}>{t('notifications.sound')}</Label>
              <p className="text-xs text-text-muted">{t('notifications.soundHint')}</p>
            </div>
          </div>
          <Switch
            id={`${uid}-sound`}
            checked={opts.sound}
            onCheckedChange={(v) => void change('sound', v)}
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void deliver(t('notifications.testTitle'), t('notifications.testBody'))}
        >
          {t('notifications.test')}
        </Button>
      </div>
    </Card>
  );
}
