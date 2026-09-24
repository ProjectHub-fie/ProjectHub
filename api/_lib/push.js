/**
 * Web Push delivery for ProjectHub Mail.
 *
 * The client subscribes in the browser and stores the subscription through
 * `/api/admin/mail/push/subscribe`; this module is the missing other half that
 * actually pushes a payload. Before it existed the mailbox wrote a
 * `mail_notifications` row and lit the in-app bell, but nothing ever called
 * `webpush.sendNotification`, so no OS-level notification arrived.
 *
 * Delivery rules:
 *   - push is optional and off unless a VAPID key pair is configured;
 *   - only administrators who turned desktop alerts on receive a push, and only
 *     for the event type they left enabled;
 *   - a subscription the push service has expired (404/410) is deleted, so the
 *     table does not accumulate dead endpoints;
 *   - a push failure is logged and swallowed. It must never stop the message
 *     from landing in the inbox, which is the durable record.
 */
import webpush from 'web-push';
import { listPushDeliveries, deletePushSubscription } from './mail-store.js';

let configured = null;

function configurePush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  // The subject is a contact the push service can use if it needs to reach the
  // sender; a mailto is the conventional value.
  const subject =
    process.env.VAPID_SUBJECT ||
    (process.env.MJ_SENDER_EMAIL ? `mailto:${process.env.MJ_SENDER_EMAIL}` : 'mailto:postmaster@localhost');

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

/** Whether a VAPID key pair is present, so a caller can skip work entirely. */
export function isPushConfigured() {
  if (configured === null) {
    try {
      configured = configurePush();
    } catch (error) {
      console.error('Mail push is misconfigured:', error.message);
      configured = false;
    }
  }
  return configured;
}

/**
 * Builds the payload the service worker renders. Only shallow fields.
 *
 * The tag is deliberately stable rather than per-message: the worker's
 * documented behaviour is that a burst of mail replaces one notification instead
 * of stacking a hundred of them, and it falls back to the same tag when this
 * field is absent.
 */
function buildPayload({ title, preview, threadId }) {
  return JSON.stringify({
    title: title || 'New email',
    body: preview || 'You have a new message in ProjectHub Mail.',
    url: threadId ? `/pbad/mail?thread=${encodeURIComponent(threadId)}` : '/pbad/mail',
    tag: 'projecthub-mail',
  });
}

/**
 * Sends a push for one mail event to every administrator who asked for it.
 *
 * Returns the number delivered; a `not_configured` result means no VAPID keys
 * are set and nothing was attempted.
 */
export async function sendMailPush({ type = 'new_email', title, preview, threadId = null } = {}) {
  if (!isPushConfigured()) return { sent: 0, skipped: 'not_configured' };

  const deliveries = await listPushDeliveries({ type });
  if (!deliveries.length) return { sent: 0, skipped: 'no_subscribers' };

  const payload = buildPayload({ title, preview, threadId });
  let sent = 0;

  await Promise.all(
    deliveries.map(async (delivery) => {
      try {
        await webpush.sendNotification(
          { endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } },
          payload,
        );
        sent += 1;
      } catch (error) {
        // 404/410 means the browser dropped the subscription; 401/403 means the
        // VAPID keys no longer match it. Both are permanent, so prune the row.
        const status = error?.statusCode;
        if (status === 404 || status === 410) {
          try {
            await deletePushSubscription(delivery.adminId, delivery.endpoint);
          } catch (pruneError) {
            console.error('Failed to prune a stale push subscription:', pruneError.message);
          }
        } else {
          console.error('Mail push send failed:', status || error.message);
        }
      }
    }),
  );

  return { sent };
}
