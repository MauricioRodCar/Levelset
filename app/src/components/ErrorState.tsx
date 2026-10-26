import { RotateCw, XOctagon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useErrorMessage } from './useErrorMessage';

export interface ErrorStateProps {
  error?: unknown;
  title?: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  error,
  title,
  onRetry,
  retrying,
  compact,
  className,
}: ErrorStateProps) {
  const { t } = useTranslation('errors');
  const message = useErrorMessage();
  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-3 rounded-lg border border-loss/40 bg-loss/5 text-sm',
        compact ? 'px-3 py-2' : 'flex-col px-6 py-8 text-center',
        className,
      )}
    >
      <XOctagon className={cn('shrink-0 text-loss', compact ? 'h-4 w-4' : 'h-7 w-7')} aria-hidden />
      <div className={cn(compact ? 'flex-1' : 'space-y-1')}>
        <p className="font-medium text-text">{title ?? t('title')}</p>
        {error !== undefined && <p className="text-text-muted">{message(error)}</p>}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
          <RotateCw className={cn(retrying && 'animate-spin')} aria-hidden />
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
