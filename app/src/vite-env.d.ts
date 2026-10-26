/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_MOCK?: string;
  readonly VITE_ENGINE_URL?: string;
  readonly VITE_ENGINE_TOKEN?: string;
  readonly VITE_ROUTER?: string;
  readonly VITE_APP_VERSION?: string;
}
