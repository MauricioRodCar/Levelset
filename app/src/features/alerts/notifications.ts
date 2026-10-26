import { useEffect } from 'react';
import i18n from 'i18next';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { engineEvents, type Alert } from '@/api';
import { toast } from '@/components/ui/toaster';
import { isTauri } from '@/lib/env';
import { prefs } from '@/lib/prefs';
import { ALERT_PREF_KEYS, getAlertPrefs } from './alertPrefs';
import { alertSentence } from './model';

/**
 * Ask Windows for notification permission (desktop app only). Asks the OS at most once per
 * install; afterwards it just reports the current state. Returns true when allowed.
 */
export async function ensureNotificationPermission(force = false): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    if (await isPermissionGranted()) return true;
    if (!force && prefs.get<boolean>(ALERT_PREF_KEYS.permissionAsked, false)) return false;
    prefs.set(ALERT_PREF_KEYS.permissionAsked, true);
    return (await requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** A short two-tone chime with Web Audio (no audio files to ship). Silent if unsupported. */
export function playChime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tones: [number, number][] = [
      [880, 0],
      [1318.5, 0.14],
    ];
    for (const [freq, at] of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.4);
    }
    setTimeout(() => void ctx.close().catch(() => undefined), 1000);
  } catch {
    /* audio is a nicety */
  }
}

/** Everything that happens when an alert rings: toast, optional chime, optional Windows notification. */
export async function notifyAlertRung(alert: Alert) {
  const t = i18n.t.bind(i18n);
  const lang = i18n.language;
  const title = t(alert.symbol ? 'alerts:notify.titleSymbol' : 'alerts:notify.title', {
    type: t(`alerts:types.${alert.type}`),
    symbol: alert.symbol ?? '',
  });
  const body = alertSentence(alert, t, lang) + (alert.note ? ` · ${alert.note}` : '');
  await deliver(title, body);
}

/** Toast + chime + Windows notification, following the user's alert preferences. */
export async function deliver(title: string, body: string) {
  const opts = getAlertPrefs();
  toast(title, { description: body, duration: 8000 });
  if (opts.sound) playChime();
  if (opts.desktop && isTauri() && (await ensureNotificationPermission())) {
    try {
      sendNotification({ title, body });
    } catch {
      /* the in-app toast already told the user */
    }
  }
}

/**
 * Mount once (AppShell): listens to SSE `alert.rung` through the shared engine event bus
 * (no second EventSource) and notifies.
 */
export function useAlertNotifications() {
  useEffect(() => engineEvents.on('alert.rung', (a) => void notifyAlertRung(a)), []);
}
