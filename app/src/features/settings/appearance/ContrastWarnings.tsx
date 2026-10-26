import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { checkContrast, displayRatio, type ThemeTokens } from '@/theme';

/** Lists WCAG contrast failures for the given tokens ("Loss on Surface: 2.8:1, needs 3:1"). */
export function ContrastWarnings({ tokens }: { tokens: ThemeTokens }) {
  const { t } = useTranslation('settings');
  const issues = checkContrast(tokens);
  if (!issues.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
        <CheckCircle2 className="h-4 w-4 text-profit" aria-hidden />
        {t('appearance.contrast.ok')}
      </p>
    );
  }
  return (
    <div role="status" className="rounded-md border border-warning/50 bg-warning/5 p-3">
      <p className="mb-1.5 flex items-center gap-2 text-sm font-medium text-text">
        <TriangleAlert className="h-4 w-4 text-warning" aria-hidden />
        {t('appearance.contrast.count', { count: issues.length })}
      </p>
      <ul className="space-y-1 text-xs text-text">
        {issues.map((i) => (
          <li key={`${i.fg}-${i.bg}`} className="tabular">
            {t('appearance.contrast.issue', {
              fg: t(`appearance.tokens.${i.fg}.label`),
              bg: t(`appearance.tokens.${i.bg}.label`),
              ratio: displayRatio(i.ratio),
              required: i.required,
            })}{' '}
            <span className="text-text-muted">
              (
              {t(
                i.kind === 'text'
                  ? 'appearance.contrast.kindText'
                  : 'appearance.contrast.kindMarker',
              )}
              )
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
