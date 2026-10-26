import { useTranslation } from 'react-i18next';
import { ApiError } from '@/api';
import { useErrorMessage } from '@/components/useErrorMessage';

/** Problem codes added with the alert / fill edits; translated in alerts:errors.* */
const LOCAL_CODES = [
  'alert_not_found',
  'run_not_found',
  'no_plan',
  'fill_not_found',
  'fill_in_use',
];

/** Translate an API error: our own codes first, then the shared errors:codes.* table. */
export function useApiErrorText() {
  const { t } = useTranslation('alerts');
  const generic = useErrorMessage();
  return (error: unknown) =>
    error instanceof ApiError && error.code && LOCAL_CODES.includes(error.code)
      ? t(`errors.${error.code}`)
      : generic(error);
}
