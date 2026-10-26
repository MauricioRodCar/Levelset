import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { AccountLimitsForm } from '../components/AccountLimitsForm';
import { FillsCard } from './FillsCard';

/** Settings > Account & limits: the full limits form (GET/PUT /settings) and today's fills. */
export function AccountLimitsTab() {
  const { t } = useTranslation('settings');
  return (
    <div className="grid max-w-6xl gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card title={t('account.title')} subtitle={t('account.subtitle')}>
        <AccountLimitsForm advanced />
      </Card>
      <div>
        <FillsCard />
      </div>
    </div>
  );
}
