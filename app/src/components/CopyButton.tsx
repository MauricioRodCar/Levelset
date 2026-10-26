import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, type ButtonProps } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/utils';

export interface CopyButtonProps extends Omit<ButtonProps, 'value' | 'onClick'> {
  /** Exact text placed on the clipboard (use priceForCopy() for prices: "358.32"). */
  value: string;
  /** Visible label; omit for an icon-only button (aria-label is still set). */
  label?: string;
  /** What the toast says was copied; defaults to `value`. Keep it short. */
  toastValue?: string;
  onCopied?: () => void;
}

/** Copies `value` and shows the toast "Copied 358.32". */
export function CopyButton({
  value,
  label,
  toastValue,
  onCopied,
  className,
  size,
  variant = 'ghost',
  ...rest
}: CopyButtonProps) {
  const { t } = useTranslation('common');
  const [done, setDone] = useState(false);

  const onClick = async () => {
    const ok = await copyText(value);
    if (ok) {
      toast(t('copy.copied', { value: toastValue ?? value }));
      setDone(true);
      window.setTimeout(() => setDone(false), 1200);
      onCopied?.();
    } else {
      toast.error(t('copy.failed'));
    }
  };

  const Icon = done ? Check : Copy;
  return (
    <Button
      variant={variant}
      size={size ?? (label ? 'sm' : 'icon-sm')}
      onClick={onClick}
      aria-label={label ? undefined : t('copy.copyValue', { value: toastValue ?? value })}
      className={cn('text-text-muted hover:text-text', className)}
      {...rest}
    >
      <Icon aria-hidden />
      {label && <span>{label}</span>}
    </Button>
  );
}
