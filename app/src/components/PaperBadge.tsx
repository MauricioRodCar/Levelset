import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** "PAPER" pill for simulated positions and lines (icon + text, never colour alone). */
export function PaperBadge({ className }: { className?: string }) {
  const { t } = useTranslation('paper');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border border-info/50 bg-info/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-text',
        className,
      )}
      title={t('badgeLabel')}
      data-testid="paper-badge"
    >
      <FlaskConical className="h-3 w-3 text-info" aria-hidden />
      {t('badge')}
      <span className="sr-only">{t('badgeLabel')}</span>
    </span>
  );
}
