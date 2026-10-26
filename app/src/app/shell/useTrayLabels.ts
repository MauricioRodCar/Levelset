import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { setTrayLabels, shellAvailable } from '@/lib/shell';

/** Keep the system-tray menu (Rust shell) in the UI language. No-op outside the desktop app. */
export function useTrayLabels() {
  const { t, i18n } = useTranslation('shell');
  useEffect(() => {
    if (!shellAvailable()) return;
    setTrayLabels({
      open: t('tray.open'),
      quit: t('tray.quit'),
      tooltip: t('tray.tooltip'),
      hidden: t('tray.hidden'),
    }).catch(() => undefined);
  }, [t, i18n.language]);
}
