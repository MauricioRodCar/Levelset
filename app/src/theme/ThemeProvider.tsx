import { useLayoutEffect, type ReactNode } from 'react';
import { applyTheme } from './apply';
import { useActiveTheme } from './store';

/**
 * Applies the active theme's tokens as CSS variables on :root whenever it changes.
 * Theme state lives in the zustand store (useThemeStore); this component only syncs the DOM.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useActiveTheme();
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return <>{children}</>;
}
