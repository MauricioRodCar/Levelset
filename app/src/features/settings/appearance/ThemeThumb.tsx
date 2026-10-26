import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { checkContrast, themeName, themeStyleVars, type Theme } from '@/theme';
import { cn } from '@/lib/utils';

/**
 * Mini preview of a theme. Its CSS variables are scoped to the button via inline style,
 * so Tailwind token classes inside render with THIS theme, not the active one.
 */
export function ThemeThumb({
  theme,
  active,
  onSelect,
}: {
  theme: Theme;
  active: boolean;
  onSelect: () => void;
}) {
  const { t, i18n } = useTranslation('settings');
  const name = themeName(theme, i18n.language);
  const issues = checkContrast(theme.tokens).length;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border text-left transition-shadow focus-ring',
        active ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-text-muted',
      )}
    >
      <div style={themeStyleVars(theme)} className="w-full bg-bg p-2.5" aria-hidden>
        <div className="rounded-md border border-border bg-surface p-2">
          <div className="mb-1.5 h-1.5 w-10 rounded bg-text-muted/70" />
          <div className="grid grid-cols-3 gap-1">
            {(['text-muted', 'loss', 'profit'] as const).map((c) => (
              <div
                key={c}
                className="relative overflow-hidden rounded-sm bg-surface2 px-1 pb-1 pt-1.5"
              >
                <span
                  className={cn(
                    'absolute inset-x-0 top-0 h-[2px]',
                    c === 'loss' ? 'bg-loss' : c === 'profit' ? 'bg-profit' : 'bg-text-muted',
                  )}
                />
                <div className="h-1.5 w-full rounded-sm bg-text" />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            <div className="h-2.5 w-8 rounded-sm bg-primary" />
            <div className="h-2.5 w-6 rounded-sm border border-border" />
            <div className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />
          </div>
        </div>
      </div>
      <div className="flex w-full items-center gap-2 border-t border-border bg-surface px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">{name}</span>
        {issues > 0 && (
          <span
            className="text-[10px] text-text-muted"
            title={t('appearance.contrast.count', { count: issues })}
          >
            {t('appearance.contrast.short', { count: issues })}
          </span>
        )}
        {theme.mode === 'light' && (
          <span className="text-[10px] uppercase text-text-muted">{t('appearance.light')}</span>
        )}
        {active && (
          <Check className="h-3.5 w-3.5 text-primary" aria-label={t('appearance.active')} />
        )}
      </div>
    </button>
  );
}
