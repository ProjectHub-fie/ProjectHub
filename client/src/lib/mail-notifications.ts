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
