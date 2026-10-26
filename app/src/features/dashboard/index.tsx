import { useTranslation } from 'react-i18next';
import { PlaceholderPage } from '@/components/PageHeader';

/**
 * Dashboard (home) — placeholder. Built by WP3 (see docs/SCREENS.md S1 and app/README.md).
 * Data: useDashboard, useTickets, useWatchlist, useTrades, useNews from '@/api'.
 * Ticket cards must use <TicketLevels> from '@/components' (ticket rule).
 */
export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  return (
    <PlaceholderPage title={t('title')} description={t('description')} note={t('placeholder')} />
  );
}
