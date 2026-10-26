import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { LANGUAGES, setLanguage, type Language } from '@/i18n';
import {
  formatMarketDate,
  formatMarketTime,
  formatMoney,
  formatNumber,
  formatPercent,
} from '@/lib/format';
import { cn } from '@/lib/utils';

const SAMPLE_TS = '2026-10-19T10:15:00-04:00';

/** Settings > Language: EN / ES with a formatting preview. */
export function LanguageTab() {
  const { t, i18n } = useTranslation('settings');
  const current = i18n.language.slice(0, 2) as Language;
  return (
    <div className="grid max-w-4xl gap-5 md:grid-cols-2">
      <Card title={t('language.title')} subtitle={t('language.subtitle')}>
        <div role="radiogroup" aria-label={t('language.title')} className="space-y-2">
          {LANGUAGES.map((lng) => {
            const active = current === lng;
            return (
              <button
                key={lng}
                type="button"
                role="radio"
                aria-checked={active}
                lang={lng}
                onClick={() => void setLanguage(lng)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left focus-ring',
                  active ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface2',
                )}
              >
                <span className="w-7 text-xs font-semibold uppercase text-text-muted">{lng}</span>
                <span className="flex-1">
                  <span className="block text-sm font-medium text-text">
                    {t(`common:language.names.${lng}`)}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {t(`language.native.${lng}`)}
                  </span>
                </span>
                {active && <Check className="h-4 w-4 text-primary" aria-hidden />}
              </button>
            );
          })}
        </div>
      </Card>
      <Card title={t('language.formats')} subtitle={t('language.formatsHint')}>
        <dl className="tabular grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-text-muted">{t('language.sample.money')}</dt>
          <dd className="text-text">{formatMoney(1234.5, current)}</dd>
          <dt className="text-text-muted">{t('language.sample.number')}</dt>
          <dd className="text-text">{formatNumber(10000.25, current)}</dd>
          <dt className="text-text-muted">{t('language.sample.percent')}</dt>
          <dd className="text-text">{formatPercent(29.4, current)}</dd>
          <dt className="text-text-muted">{t('language.sample.date')}</dt>
          <dd className="text-text">{formatMarketDate(SAMPLE_TS, current)}</dd>
          <dt className="text-text-muted">{t('language.sample.marketTime')}</dt>
          <dd className="text-text">{formatMarketTime(SAMPLE_TS, current)}</dd>
        </dl>
        <p className="mt-3 text-xs text-text-muted">{t('language.marketTimeNote')}</p>
      </Card>
    </div>
  );
}
