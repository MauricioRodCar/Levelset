import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Small reminder that a broker's CFD symbol / contract size may differ from the US stock analysed. */
export function InstrumentNote({ className }: { className?: string }) {
  const { t } = useTranslation('tickets');
  return (
    <p className={cn('flex items-start gap-1.5 text-xs text-text-muted', className)}>
      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>{t('instrumentNote')}</span>
    </p>
  );
}
