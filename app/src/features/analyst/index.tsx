import { LineChart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ComingSoon } from '@/components/ComingSoon';

/** Analyst (trader-analyst) — v1.1. */
export default function AnalystPage() {
  const { t } = useTranslation('shell');
  return (
    <ComingSoon
      icon={LineChart}
      title={t('nav.analyst')}
      version="v1.1"
      description={t('analyst.description')}
      bullets={t('analyst.bullets', { returnObjects: true }) as string[]}
    />
  );
}
