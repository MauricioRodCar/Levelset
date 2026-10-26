import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, type Language } from '@/i18n';
import { cn } from '@/lib/utils';

/** EN / ES segmented switch. Persists the choice. */
export function LanguageSwitch({
  className,
  size = 'sm',
}: {
  className?: string;
  size?: 'sm' | 'md';
}) {
  const { t, i18n } = useTranslation('common');
  const current = i18n.language.slice(0, 2) as Language;
  return (
    <div
      role="radiogroup"
      aria-label={t('language.label')}
      className={cn('inline-flex rounded-md border border-border bg-bg p-0.5', className)}
    >
      {LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          role="radio"
          aria-checked={current === lng}
          lang={lng}
          title={t(`language.names.${lng}`)}
          onClick={() => void setLanguage(lng)}
          className={cn(
            'rounded px-2 font-semibold uppercase transition-colors focus-ring',
            size === 'sm' ? 'h-6 text-xs' : 'h-8 px-3 text-sm',
            current === lng ? 'bg-primary text-on-primary' : 'text-text-muted hover:text-text',
          )}
        >
          {t(`language.short.${lng}`)}
        </button>
      ))}
    </div>
  );
}
