import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { AccountLimitsForm } from '../components/AccountLimitsForm';

/**
 * Account & limits — PLACEHOLDER for WP5 (Settings pages).
 * The reusable <AccountLimitsForm> (GET/PUT /settings, used by onboarding) already works;
 * WP5 can extend it (cash buffer, max order, position cap, requireStop...) and polish this tab.
 */
export function AccountLimitsTab() {
  const { t } = useTranslation('settings');
  return (
    <Card title={t('account.title')} subtitle={t('account.subtitle')} className="max-w-3xl">
      <AccountLimitsForm />
    </Card>
  );
}
