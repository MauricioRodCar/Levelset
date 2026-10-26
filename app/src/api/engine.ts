import { env, isTauri } from '@/lib/env';

export interface EngineInfo {
  url: string;
  token: string;
}

let current: EngineInfo = { url: env.engineUrl, token: env.engineToken };

/**
 * Resolve where the engine lives.
 * - In Tauri: the Rust command `get_engine_info` (reads LEVELSET_ENGINE_URL / LEVELSET_ENGINE_TOKEN).
 * - In a browser: VITE_ENGINE_URL / VITE_ENGINE_TOKEN (default http://127.0.0.1:8765, "dev").
 * - In mock mode the URL is still used; MSW intercepts requests to it.
 */
export async function resolveEngineInfo(): Promise<EngineInfo> {
  if (isTauri() && !env.mock) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const info = await invoke<EngineInfo>('get_engine_info');
      if (info?.url) current = { url: info.url.replace(/\/$/, ''), token: info.token };
    } catch (e) {
      console.warn('get_engine_info failed, using env defaults', e);
    }
  }
  return current;
}

export function getEngineInfo(): EngineInfo {
  return current;
}

export function setEngineInfo(info: EngineInfo) {
  current = { url: info.url.replace(/\/$/, ''), token: info.token };
}
