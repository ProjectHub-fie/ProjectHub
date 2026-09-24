/* eslint-env serviceworker */
/**
 * ProjectHub Mail service worker.
 *
 * Scope is deliberately tiny. A service worker runs in a context with no DOM and
 * no page session, so the rules are:
 *
 *   - No credentials live here. Not the Mailjet key, not the Resend key, not the
 *     session token. The worker only ever *receives* an already-built push
 *     payload and renders it.
 *   - Push payloads carry a title, a short body and a URL. They never carry an
 *     email body, so nothing sensitive is stored in the notification.
 *   - Nothing is cached. Caching dashboard responses here could serve one
 *     administrator's mail to another on a shared machine, which is exactly the
 *     failure a same-origin cache makes easy.
 */

const ADMIN_MAIL_URL = "/pbad/mail";

self.addEventListener("install", (event) => {
  // Take over immediately so a newly deployed worker handles the next push.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Builds the in-dashboard URL an opened notification should land on.
 *
 * Only a same-origin path is honoured: a push payload that asked to navigate
 * anywhere else is ignored in favour of the default mail route, so a compromised
 * sender cannot bounce the administrator to an arbitrary site.
 */
function safeTargetUrl(rawUrl) {
  if (!rawUrl) return ADMIN_MAIL_URL;
  try {
    const url = new URL(rawUrl, self.location.origin);
    if (url.origin !== self.location.origin) return ADMIN_MAIL_URL;
    if (!url.pathname.startsWith("/pbad")) return ADMIN_MAIL_URL;
    return `${url.pathname}${url.search}`;
  } catch {
    return ADMIN_MAIL_URL;
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "New email", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "New email";
  const body = payload.body || "You have a new message in ProjectHub Mail.";
  const targetUrl = safeTargetUrl(payload.url);
  const tag = payload.tag || "projecthub-mail";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      // A stable tag means a burst of mail replaces one notification rather than
      // stacking a hundred of them.
      renotify: true,
      icon: "/public/Project.jpg",
      badge: "/public/Project.jpg",
      data: { url: targetUrl },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = safeTargetUrl(event.notification.data?.url);

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      // Focus an existing dashboard tab and route it, instead of opening a
      // duplicate window for every notification.
      for (const client of allClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin !== self.location.origin) continue;
        if (!clientUrl.pathname.startsWith("/pbad")) continue;

        await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(targetUrl);
          } catch {
            // Cross-document navigate is not always permitted; a postMessage
            // lets the SPA route instead.
            client.postMessage({ type: "mail-open", url: targetUrl });
          }
        }
        return;
      }

      await self.clients.openWindow(targetUrl);
    })(),
  );
});
