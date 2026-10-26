import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { PREF_KEYS, prefs } from '@/lib/prefs';

export const LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

export const NAMESPACES = [
  'common',
  'shell',
  'dashboard',
  'pipeline',
  'tickets',
  'alerts',
  'settings',
  'onboarding',
  'connections',
  'errors',
  'paper',
  'analyst',
  'congress',
  'ai',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** All locale JSON files, bundled: src/locales/<lang>/<namespace>.json */
const files = import.meta.glob<Record<string, unknown>>('../locales/*/*.json', {
  eager: true,
  import: 'default',
});

export function buildResources() {
  const resources: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [path, data] of Object.entries(files)) {
    const m = path.match(/locales\/([^/]+)\/([^/]+)\.json$/);
    if (!m) continue;
    const [, lang, ns] = m;
    (resources[lang] ??= {})[ns] = data;
  }
  return resources;
}

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);
}

export function detectLanguage(): Language {
  const saved = prefs.get<string | null>(PREF_KEYS.language, null);
  if (isLanguage(saved)) return saved;
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export async function initI18n(lng: Language = detectLanguage()) {
  if (i18n.isInitialized) {
    await i18n.changeLanguage(lng);
    return i18n;
  }
  await i18n.use(initReactI18next).init({
    resources: buildResources(),
    lng,
    fallbackLng: 'en',
    supportedLngs: [...LANGUAGES],
    ns: [...NAMESPACES],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  document.documentElement.lang = lng;
  return i18n;
}

/** Switch UI language and persist the choice. */
export async function setLanguage(lng: Language) {
  prefs.set(PREF_KEYS.language, lng);
  await i18n.changeLanguage(lng);
  document.documentElement.lang = lng;
}

export default i18n;
