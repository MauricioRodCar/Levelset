import { useTranslation } from 'react-i18next';
import { PlaceholderPage } from '@/components/PageHeader';

/**
 * Alerts — placeholder. Built by WP5 (see docs/SCREENS.md S3 and app/README.md).
 * Data: useAlerts, useCreateAlert, useAlertsFromPlan, useDeleteAlert from '@/api'.
 * Desktop notifications: subscribe with engineEvents.on('alert.rung', ...) and use
 * @tauri-apps/plugin-notification (already registered in src-tauri).
 */
export default function AlertsPage() {
  const { t } = useTranslation('alerts');
  return (
    <PlaceholderPage title={t('title')} description={t('description')} note={t('placeholder')} />
  );
}
