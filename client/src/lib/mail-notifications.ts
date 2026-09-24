/**
 * Browser notification permission and delivery for Mail.
 *
 * Two rules, both from the requirements:
 *
 *   1. Permission is never requested on page load. `requestPermission` is called
 *      only from the "Enable Notifications" button, so an administrator is never
 *      interrupted by a browser prompt they did not ask for.
 *   2. A denied or dismissed permission is remembered, so the dashboard asks once
 *      and then stops. The setting screen always remains available for a manual
 *      change.
 *
 * Notification content is deliberately shallow — a sender and a subject line.
 * The full body is fetched only when the administrator opens the message, so a
 * notification never carries mail content into the OS notification centre.
 */

const PROMPT_KEY = "projecthub-mail-notification-prompt";

export type PermissionState = "default" | "granted" | "denied" | "unsupported";

export function notificationSupport() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function currentPermission(): PermissionState {
  if (!notificationSupport()) return "unsupported";
  return Notification.permission as PermissionState;
}

/** Whether the in-app prompt has already been shown and dismissed. */
export function promptDismissed(): boolean {
  try {
    return window.localStorage.getItem(PROMPT_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export function dismissPrompt() {
  try {
    window.localStorage.setItem(PROMPT_KEY, "dismissed");
  } catch {
    // Private-mode storage failures are not worth surfacing.
  }
}

/** Clears the "asked once" flag so the prompt can be offered again. */
export function resetPromptDismissal() {
  try {
    window.localStorage.removeItem(PROMPT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Requests permission. Only ever called from an explicit user action.
 *
 * Returns the resulting state so the caller can react to a denial without asking
 * again.
 */
export async function requestPermission(): Promise<PermissionState> {
  if (!notificationSupport()) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    return result as PermissionState;
  } catch {
    return "denied";
  }
}

/** Converts a base64 VAPID key into the Uint8Array `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Registers the service worker and stores this browser's push subscription with
 * the server.
 *
 * Shared by the settings panel and the in-app prompt so both paths that turn
 * desktop alerts on end with a real subscription — the absence of which is what
 * made notifications silently never arrive. Returns true when the server has a
 * subscription it can push to.
 */
export async function ensurePushSubscription(): Promise<boolean> {
  if (!notificationSupport() || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }
  try {
    const response = await fetch("/api/admin/mail/push/public-key", { credentials: "include" });
    if (!response.ok) return false;
    const { publicKey } = (await response.json()) as { publicKey: string | null };
    if (!publicKey) return false;

    const registration = await navigator.serviceWorker.register("/mail-sw.js", { scope: "/" });
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const json = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> };
    if (!json.endpoint || !json.keys) return false;

    const saved = await fetch("/api/admin/mail/push/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    return saved.ok;
  } catch {
    // Private mode, no VAPID key and unsupporting browsers all land here; the
    // in-dashboard badge still works without push.
    return false;
  }
}

/**
 * Shows a desktop notification for a mail item.
 *
 * Clicking it focuses the existing dashboard tab and navigates to the thread
 * rather than opening a second tab, which is what a mail client is expected to
 * do.
 */
export function showMailNotification({
  title,
  body,
  tag,
  href,
}: {
  title: string;
  body: string;
  tag?: string;
  href: string;
}) {
  if (currentPermission() !== "granted") return null;

  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: "/public/Project.jpg",
      badge: "/public/Project.jpg",
    });

    notification.onclick = () => {
      window.focus();
      // Same-document navigation keeps the SPA state; the mail page reads the
      // `thread`/`message` query params to open the right item.
      window.location.assign(href);
      notification.close();
    };

    return notification;
  } catch {
    // Some browsers throw when notifications are constructed outside a service
    // worker; failing quietly is better than breaking the dashboard.
    return null;
  }
}
