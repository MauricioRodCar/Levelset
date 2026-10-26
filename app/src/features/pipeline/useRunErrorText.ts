import { useTranslation } from 'react-i18next';
import { ApiError } from '@/api';
import { useErrorMessage } from '@/components/useErrorMessage';
import { parsePrevDetail } from './model';

/** Run-step errors in plain words: 409 previous_step_not_done names the step that must run first. */
export function useRunErrorText() {
  const { t } = useTranslation('pipeline');
  const message = useErrorMessage();
  return (error: unknown): string => {
    if (error instanceof ApiError && error.code === 'previous_step_not_done') {
      const prev = parsePrevDetail(error.detail);
      if (prev)
        return t('errors.previous', {
          step: t(`steps.${prev.step}`),
          status: t(`common:status.${prev.status}`, { defaultValue: prev.status }),
        });
    }
    if (
      error instanceof ApiError &&
      error.code &&
      ['run_busy', 'no_ticker', 'run_not_found'].includes(error.code)
    )
      return t(`errors.${error.code}`);
    return message(error);
  };
}
