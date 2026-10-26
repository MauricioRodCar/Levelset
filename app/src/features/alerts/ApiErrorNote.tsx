import { useApiErrorText } from './useApiErrorText';

/** Inline error line for forms and dialogs (dot marker + text, never colour alone). */
export function ApiErrorNote({ error }: { error: unknown }) {
  const text = useApiErrorText();
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-text">
      <span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-loss" />
      {text(error)}
    </p>
  );
}
