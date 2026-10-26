import { create } from 'zustand';
import { PREF_KEYS, prefs } from '@/lib/prefs';

/** Shell UI state persisted in local prefs. */
interface UiState {
  sidebarCollapsed: boolean;
  onboardingDone: boolean;
  disclaimerAcceptedAt: string | null;
  hydrate: () => void;
  toggleSidebar: () => void;
  completeOnboarding: () => void;
  acceptDisclaimer: () => void;
  /** For Settings > About "Run setup again". */
  resetOnboarding: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: false,
  onboardingDone: false,
  disclaimerAcceptedAt: null,
  hydrate: () =>
    set({
      sidebarCollapsed: prefs.get(PREF_KEYS.sidebarCollapsed, false),
      onboardingDone: prefs.get(PREF_KEYS.onboardingDone, false),
      disclaimerAcceptedAt: prefs.get<string | null>(PREF_KEYS.disclaimerAcceptedAt, null),
    }),
  toggleSidebar: () => {
    const v = !get().sidebarCollapsed;
    prefs.set(PREF_KEYS.sidebarCollapsed, v);
    set({ sidebarCollapsed: v });
  },
  completeOnboarding: () => {
    prefs.set(PREF_KEYS.onboardingDone, true);
    set({ onboardingDone: true });
  },
  acceptDisclaimer: () => {
    const at = new Date().toISOString();
    prefs.set(PREF_KEYS.disclaimerAcceptedAt, at);
    set({ disclaimerAcceptedAt: at });
  },
  resetOnboarding: () => {
    prefs.set(PREF_KEYS.onboardingDone, false);
    set({ onboardingDone: false });
  },
}));
