import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/components/ui/toaster';
import { useFormat } from '@/i18n/useFormat';
import { copyText } from '@/lib/clipboard';
import { priceForCopy } from '@/lib/format';

/**
 * Copy a price the way trading platforms expect it ("358.32", dot decimal) and toast it in the
 * UI locale ("Copied 358.32" / "Copiado 358,32").
 */
export function useCopyPrice() {
  const { t } = useTranslation('common');
  const f = useFormat();
  return useCallback(
    async (value: number) => {
      const ok = await copyText(priceForCopy(value));
      if (ok) toast(t('copy.copied', { value: f.price(value) }));
      else toast.error(t('copy.failed'));
      return ok;
    },
    [t, f],
  );
}

/** Copy arbitrary text (full ticket, export) and toast a short description of it. */
export function useCopyText() {
  const { t } = useTranslation('common');
  return useCallback(
    async (text: string, toastValue: string) => {
      const ok = await copyText(text);
      if (ok) toast(t('copy.copied', { value: toastValue }));
      else toast.error(t('copy.failed'));
      return ok;
    },
    [t],
  );
}
