import { isTauri } from './env';

/**
 * Desktop-shell features (src-tauri/src/system.rs): Start with Windows, keep the PC awake during
 * market hours, the demo-mode marker, the tray menu labels and the native save dialog.
 * None of these exist in the browser / web demo: callers check `shellAvailable()` first
 * (saveTextFile falls back to a browser download).
 */
export const shellAvailable = () => isTauri();

export interface SystemPrefs {
  /** Levelset starts with Windows (per-user Run entry, no admin). */
  autostart: boolean;
  /** Keep the PC from sleeping while the market is open (engine /status). */
  keepAwake: boolean;
  /** The `<app data>\demo` marker exists (demo on next start). */
  demoMarker: boolean;
  /** LEVELSET_DEMO is set in the environment: the toggle cannot change it. */
  demoEnv: boolean;
  /** The running engine was started in demo mode. */
  demoActive: boolean;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

export const getSystemPrefs = () => invoke<SystemPrefs>('get_system_prefs');
export const setAutostart = (enabled: boolean) => invoke<SystemPrefs>('set_autostart', { enabled });
export const setKeepAwake = (enabled: boolean) =>
  invoke<SystemPrefs>('set_keep_awake', { enabled });
/** Writes or removes the demo marker and restarts Levelset (never returns on success). */
export const setDemoMode = (enabled: boolean) => invoke<void>('set_demo_mode', { enabled });
export const setTrayLabels = (labels: {
  open: string;
  quit: string;
  tooltip: string;
  hidden: string;
}) => invoke<void>('set_tray_labels', labels);

const MIME: Record<string, string> = {
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
};

function browserDownload(name: string, text: string) {
  const ext = name.split('.').pop() ?? 'txt';
  const blob = new Blob([text], { type: `${MIME[ext] ?? 'text/plain'};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type SaveResult = { saved: true; path: string | null } | { saved: false };

/**
 * Save text as a local file. Desktop: the native "Save as" dialog (path returned; `saved: false`
 * when the user cancels). Browser / web demo: a download (path unknown).
 */
export async function saveTextFile(
  name: string,
  text: string,
  filterLabel?: string,
): Promise<SaveResult> {
  if (shellAvailable()) {
    const ext = name.split('.').pop() ?? 'txt';
    const path = await invoke<string | null>('save_text_file', {
      fileName: name,
      contents: text,
      filterName: filterLabel ?? ext.toUpperCase(),
      extensions: [ext],
    });
    return path ? { saved: true, path } : { saved: false };
  }
  browserDownload(name, text);
  return { saved: true, path: null };
}
