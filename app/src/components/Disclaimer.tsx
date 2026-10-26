import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** The full disclaimer text (used in the dialog and in onboarding). */
export function DisclaimerText({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const points = t('disclaimer.points', { returnObjects: true }) as string[];
  return (
    <div className={cn('space-y-3 text-sm text-text', className)}>
      <p>{t('disclaimer.intro')}</p>
      <ul className="list-disc space-y-1.5 pl-5 text-text-muted">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

export function DisclaimerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('disclaimer.title')}</DialogTitle>
          <DialogDescription>{t('disclaimer.short')}</DialogDescription>
        </DialogHeader>
        <DisclaimerText />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="primary">{t('actions.close')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Persistent slim banner: "Not financial advice" + data-delay notice + link to the full text.
 * Rendered by the app shell on every screen.
 */
export function DisclaimerBanner({
  dataDelaySeconds,
  className,
}: {
  dataDelaySeconds?: number;
  className?: string;
}) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const delayMin = dataDelaySeconds ? Math.round(dataDelaySeconds / 60) : 0;
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-t border-border bg-surface px-4 py-1.5 text-xs text-text-muted',
        className,
      )}
      role="note"
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      <span>{t('disclaimer.short')}</span>
      {delayMin > 0 && (
        <>
          <span aria-hidden>·</span>
          <span>{t('disclaimer.delayed', { minutes: delayMin })}</span>
        </>
      )}
      <Button
        variant="link"
        size="sm"
        className="ml-auto h-auto text-xs"
        onClick={() => setOpen(true)}
      >
        {t('disclaimer.read')}
      </Button>
      <DisclaimerDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
