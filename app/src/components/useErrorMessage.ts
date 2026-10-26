import { useTranslation } from 'react-i18next';
import { ApiError, isNetworkError } from '@/api/client';

/** Translate an API error into a user message: Problem.code -> errors:codes.<code>. */
export function useErrorMessage() {
  const { t } = useTranslation('errors');
  return (error: unknown): string => {
    if (isNetworkError(error)) return t('engineOffline');
    if (error instanceof ApiError) {
      if (error.code)
        return t(`codes.${error.code}`, {
          defaultValue: error.detail || error.title || t('generic'),
        });
      if (error.status === 404) return t('notFound');
      return error.detail || error.title || t('generic');
    }
    return t('generic');
  };
}
