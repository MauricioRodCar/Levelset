import { useTranslation } from 'react-i18next';
import { PlaceholderPage } from '@/components/PageHeader';

/**
 * Data & SEC — PLACEHOLDER for WP5.
 * Should edit Settings.data.secUserAgent and data.demoMode via useSettings / useUpdateSettings,
 * and explain data delay / sources (Yahoo, SEC EDGAR, Nasdaq Trader).
 */
export function DataSecTab() {
  const { t } = useTranslation('settings');
  return (
    <PlaceholderPage
      title={t('data.title')}
      description={t('data.description')}
      note={t('placeholder')}
    />
  );
}
