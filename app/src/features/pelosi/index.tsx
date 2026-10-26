import { Landmark } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ComingSoon } from '@/components/ComingSoon';

/** Pelosi / Congress trades (trader-pelosi) — v1.1. */
export default function PelosiPage() {
  const { t } = useTranslation('shell');
  return (
    <ComingSoon
      icon={Landmark}
      title={t('nav.pelosi')}
      version="v1.1"
      description={t('pelosi.description')}
      bullets={t('pelosi.bullets', { returnObjects: true }) as string[]}
    />
  );
}
