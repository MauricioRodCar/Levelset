/** Build-time flags. */
export const env = {
  /** VITE_MOCK=1 runs against the in-browser MSW mock engine (demo / GitHub Pages). */
  mock: import.meta.env.VITE_MOCK === '1' || import.meta.env.VITE_MOCK === 'true',
  engineUrl: (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? 'http://127.0.0.1:8765',
  engineToken: (import.meta.env.VITE_ENGINE_TOKEN as string | undefined) ?? 'dev',
  /** VITE_ROUTER=hash for static hosting without server rewrites (GitHub Pages). */
  hashRouter: import.meta.env.VITE_ROUTER === 'hash',
  appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? __APP_VERSION__,
};

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
