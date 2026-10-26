import { useTranslation } from 'react-i18next';
import { PlaceholderPage } from '@/components/PageHeader';

/**
 * AI (optional) — PLACEHOLDER for WP5.
 * BYO Claude API key, stored in Windows Credential Manager via the Tauri shell (never in prefs / localStorage).
 * Off by default.
 */
export function AiTab() {
  const { t } = useTranslation('settings');
  return (
    <PlaceholderPage
      title={t('ai.title')}
      description={t('ai.description')}
      note={t('placeholder')}
    />
  );
}
