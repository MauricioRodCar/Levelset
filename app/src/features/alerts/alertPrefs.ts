import { prefs } from '@/lib/prefs';

/** Local preference keys owned by the Alerts feature (prefs store, never secrets). */
export const ALERT_PREF_KEYS = {
  desktop: 'alerts.desktopNotifications',
  sound: 'alerts.sound',
  permissionAsked: 'alerts.notificationPermissionAsked',
} as const;

export interface AlertPrefs {
  /** Windows notification when an alert rings (desktop app only). Default on. */
  desktop: boolean;
  /** Short chime with the in-app toast. Default on. */
  sound: boolean;
}

export function getAlertPrefs(): AlertPrefs {
  return {
    desktop: prefs.get<boolean>(ALERT_PREF_KEYS.desktop, true),
    sound: prefs.get<boolean>(ALERT_PREF_KEYS.sound, true),
  };
}

export function setAlertPref(key: keyof AlertPrefs, value: boolean) {
  prefs.set(ALERT_PREF_KEYS[key], value);
}
