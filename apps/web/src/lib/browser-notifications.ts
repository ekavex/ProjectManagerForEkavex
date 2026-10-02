/**
 * Browser notifications (spec section 40): a desktop alert when something new arrives in
 * the in-app feed while Ekavist is open in a background tab.
 *
 * Opt-in per device. The browser's permission is the real gate; the stored flag only
 * remembers that this person asked for them here, so turning them off in Settings does
 * not require a trip to the browser's site settings.
 */
import type { Notification as AppNotification } from '@ekavist/shared';
import { useEffect, useRef } from 'react';

const STORAGE_KEY = 'ekavist.browserNotifications';

export function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function browserNotificationsEnabled(): boolean {
  if (!browserNotificationsSupported() || window.Notification.permission !== 'granted') {
    return false;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Asks the browser for permission and remembers the choice. Resolves to the outcome. */
export async function setBrowserNotifications(on: boolean): Promise<boolean> {
  if (!browserNotificationsSupported()) return false;
  if (on && window.Notification.permission !== 'granted') {
    const answer = await window.Notification.requestPermission();
    if (answer !== 'granted') return false;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage can be unavailable (private mode); the setting then lasts for this page only.
  }
  return on;
}

/**
 * Shows a browser notification for each unread item that was not in the previous list.
 * The first list after loading is only remembered, so opening the app never replays a
 * backlog of alerts.
 */
export function useBrowserNotifications(
  items: readonly AppNotification[] | undefined,
  open: (link: string | null) => void,
): void {
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (items == null) return;
    if (seen.current == null) {
      seen.current = new Set(items.map((item) => item.id));
      return;
    }
    const fresh = items.filter((item) => item.readAt == null && !seen.current?.has(item.id));
    for (const item of items) seen.current.add(item.id);

    if (fresh.length === 0 || !browserNotificationsEnabled() || !document.hidden) return;
    for (const item of fresh.slice(0, 3)) {
      const alert = new window.Notification(item.title, { body: item.body, tag: item.id });
      alert.onclick = () => {
        window.focus();
        open(item.link);
        alert.close();
      };
    }
  }, [items, open]);
}
