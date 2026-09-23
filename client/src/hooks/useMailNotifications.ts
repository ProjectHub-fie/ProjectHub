/**
 * Mail notification state, shared by the header bell and the settings panel.
 *
 * Why polling and not push: the deployment is Vercel serverless, so there is no
 * always-on process to hold a WebSocket open. Web Push is used when the browser
 * supports it and the administrator has granted permission; otherwise the badge
 * falls back to a slow, visibility-aware poll.
 *
 * The poll is the important constraint:
 *   - it stops entirely while the tab is hidden (`document.hidden`), so a
 *     background tab costs no database queries;
 *   - it polls every 60 s while visible, and does one immediate refresh when the
 *     tab becomes visible again, so nothing is missed on return;
 *   - it only asks for the unread count, which is a single aggregate query.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { mailApi, type MailCounts, type MailNotification, type NotificationSettings } from "@/lib/mail-api";

/** Visible-tab poll interval. Slow on purpose: this is a badge, not a feed. */
const POLL_INTERVAL_MS = 60_000;

export type MailNotificationState = {
  counts: MailCounts | null;
  notifications: MailNotification[];
  settings: NotificationSettings | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  /** Re-reads counts without touching notifications; used after local actions. */
  refreshCounts: () => Promise<void>;
  /**
   * Optimistically zeroes the unread counts and notifications.
   *
   * Called right after the reader marks a conversation read, so the sidebar badge
   * updates immediately instead of waiting for the next poll.
   */
  markAllLocal: () => void;
};

export function useMailNotifications({ enabled = true }: { enabled?: boolean } = {}): MailNotificationState {
  const [counts, setCounts] = useState<MailCounts | null>(null);
  const [notifications, setNotifications] = useState<MailNotification[]>([]);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Guards against overlapping requests when a manual refresh races a poll.
  const inFlight = useRef(false);

  const load = useCallback(async (withNotifications: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (withNotifications) {
        const data = await mailApi.notifications(false);
        setCounts(data.counts);
        setNotifications(data.items);
        setSettings(data.settings);
      } else {
        setCounts(await mailApi.counts());
      }
    } catch {
      // A signed-out or moderator session gets 401/403 here; the badge simply
      // stays empty rather than surfacing an error to the whole dashboard.
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);
  const refreshCounts = useCallback(() => load(false), [load]);

  const markAllLocal = useCallback(() => {
    setCounts((current) => (current ? { ...current, inbox: 0 } : current));
    setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load(true);
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        // No polling while hidden: a background tab must not accrue queries.
        if (typeof document !== "undefined" && document.hidden) return;
        void load(true);
      }, POLL_INTERVAL_MS);
    };

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Catch up immediately on return, then resume the slow cadence.
        void load(true);
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, load]);

  return { counts, notifications, settings, isLoading, refresh, refreshCounts, markAllLocal };
}
