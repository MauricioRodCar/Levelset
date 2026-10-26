import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/components/ui/toaster';
import { saveTextFile } from '@/lib/shell';

/**
 * Save text to a file with feedback: the native "Save as" dialog on desktop, a download in the
 * browser / web demo. Toasts "Saved to <path>" (or "Saved <name>"); a cancelled dialog is silent.
 */
export function useSaveFile() {
  const { t } = useTranslation('common');
  return useCallback(
    async (name: string, text: string, filterLabel?: string) => {
      try {
        const r = await saveTextFile(name, text, filterLabel);
        if (!r.saved) return false;
        toast(r.path ? t('file.savedTo', { path: r.path }) : t('file.saved', { name }));
        return true;
      } catch (e) {
        toast.error(t('file.saveFailed', { detail: e instanceof Error ? e.message : String(e) }));
        return false;
      }
    },
    [t],
  );
}
