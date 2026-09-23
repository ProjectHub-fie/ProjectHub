import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  currentPermission,
  dismissPrompt,
  promptDismissed,
  requestPermission,
} from "@/lib/mail-notifications";

/**
 * In-app prompt offering desktop notifications.
 *
 * Shown as a small banner rather than calling `Notification.requestPermission()`
 * on load: a browser prompt the administrator did not ask for is both annoying
 * and, once denied, impossible to re-ask from the page. Choosing "Not Now"
 * records the dismissal so the banner does not return on every visit, while the
 * settings panel still lets them enable it later.
 */
export function MailNotificationPrompt({ onEnabled }: { onEnabled?: () => void }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Only offer when the browser supports notifications, permission has not
    // already been decided, and the prompt has not been dismissed before.
    setVisible(currentPermission() === "default" && !promptDismissed());
  }, []);

  if (!visible) return null;

  const handleEnable = async () => {
    setBusy(true);
    const result = await requestPermission();
    setBusy(false);
    setVisible(false);
    if (result === "granted") onEnabled?.();
  };

  const handleDismiss = () => {
    dismissPrompt();
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Enable mail notifications"
      className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <div className="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
        <Bell className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Enable mail notifications?</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Get notified when new ProjectHub emails arrive.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button size="sm" onClick={handleEnable} disabled={busy} data-testid="mail-enable-notifications">
            Enable Notifications
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss} data-testid="mail-dismiss-notifications">
            Not Now
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss notification prompt"
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
