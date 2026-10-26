import { useTranslation } from 'react-i18next';
import { PlaceholderPage } from '@/components/PageHeader';

/**
 * Connections — placeholder. Platform cards (cTrader, MT4, MT5, Alpaca, IBKR) with copy/export how-tos.
 * See docs/SCREENS.md S5. Ticket exports: fetchTicketExport(id, format) from '@/api'.
 */
export default function ConnectionsPage() {
  const { t } = useTranslation('connections');
  return (
    <PlaceholderPage title={t('title')} description={t('description')} note={t('placeholder')} />
  );
}
