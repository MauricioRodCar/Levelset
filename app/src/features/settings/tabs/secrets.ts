import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/lib/env';

/**
 * Secrets live in Windows Credential Manager through the Tauri shell (src-tauri/src/secrets.rs).
 * The UI can save, check and delete a secret but never read it back. Never use prefs/localStorage.
 */
export const CLAUDE_KEY_NAME = 'claude_api_key';

export const secretsAvailable = () => isTauri();

export async function setSecret(name: string, value: string): Promise<void> {
  await invoke('set_secret', { name, value });
}

export async function hasSecret(name: string): Promise<boolean> {
  return invoke<boolean>('has_secret', { name });
}

export async function deleteSecret(name: string): Promise<void> {
  await invoke('delete_secret', { name });
}
