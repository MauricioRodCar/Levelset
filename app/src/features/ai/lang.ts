import { useTranslation } from 'react-i18next';
import type { AiLang } from '@/api';

/** The UI language as the engine's AiLang. */
export function useAiLang(): AiLang {
  const { i18n } = useTranslation();
  return i18n.language?.startsWith('es') ? 'es' : 'en';
}

/** "ai.disclaimer" (engine) -> "ai:disclaimer" (i18n namespace:key). */
export function disclaimerI18nKey(key: string): string {
  return key.startsWith('ai.') ? `ai:${key.slice(3)}` : 'ai:disclaimer';
}
