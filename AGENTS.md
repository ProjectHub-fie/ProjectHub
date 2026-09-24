# AGENTS.md

## Testing

Tests use the Node built-in runner (`node:test`) and the assertion module. There
is no other test framework installed, so no new dependency is needed to run them.

```bash
npm run test:unit   # no database required
npm test            # everything
```

`npm test` must be run with a real Postgres URL to exercise the auth flows,
because the session store and the user tables live there. Tests that need it are
skipped, not failed, when it is absent:

```bash
DATABASE_URL='postgres://...' npm test
```

The admin login tests additionally need a valid account, otherwise they are
skipped:

```bash
ADMIN_PIN='...' ADMIN_PASSWORD='...' DATABASE_URL='postgres://...' npm test
```

Point `DATABASE_URL` at a development database. `tests/auth-flow.test.mjs` writes
real rows, namespaces every one of them with a random per-run prefix, and deletes
them in an `after` hook. `tests/admin-auth.test.mjs` creates real `admin_sessions`
rows when it logs in; they expire on their own but can be cleared with
`DELETE FROM admin_sessions`.

Always use `--test-force-exit`. `api/lib/db.js` holds a postgres pool open, which
keeps the event loop alive and otherwise hangs the runner.

### What the suite covers

- `session-token.test.mjs` — token signature, tampering, forged secrets, expiry,
  and the input validation that runs before any database call.
- `auth-flow.test.mjs` — register, login, duplicate emails, blocked accounts,
  profile updates, and that a token resolves to its own subject.
- `admin-auth.test.mjs` — unauthenticated access, cookie hardening (`HttpOnly`,
  `Secure`, `SameSite=None`), session establishment, and logout invalidation.
- `client-auth.test.mjs` — the client hook and page invariants, read from source
  because no DOM test environment is installed.
- `email-validation.test.mjs` / `password-validation.test.mjs` — the contact and
  registration rules, loaded straight from `client/src/lib/*.ts` (Node 22 strips
  the types, and those modules import nothing from React or the DOM). Both files
  also grep `api/index.js` and `server/routes.ts` to assert the backends carry
  the same validators, because the form is not a security boundary.

### Client modules are loadable from node:test

`client/src/lib/*.ts` has no path alias imports, so `import { x } from
'../client/src/lib/foo.ts'` works under the Node test runner without a build
step. Keep new shared-validation modules free of `@/` imports to preserve this.

Tailwind class names must be checked in the built CSS, not only in the source,
and against the newest bundle — `dist/public/assets/` accumulates one
`index-*.css` per build, so grabbing the first match can verify stale output.
`animate-in`/`slide-in-from-*` work, and `.duration-*` is emitted for both
`animation-duration` and `transition-duration`, so it overrides the .15s default
that `.animate-in` sets.

## Auth architecture

Two separate mechanisms, deliberately:

- **Public API** (`api/index.js`) is token based. The client stores an
  HMAC-signed token in `localStorage` and sends it as `X-User-Session`. The
  signature is verified with `SESSION_SECRET` and the payload carries `iat`/`exp`
  (default 30 days, `SESSION_TTL_DAYS`).
- **Admin dashboard** (`api/admin/index.js`) is cookie based, using
  `express-session` with a Postgres store. An anonymous visitor must never reach
  admin data, so the admin function owns every `/api/admin/*` route.

`SESSION_SECRET` is required by both. Neither falls back to a default value: a
literal fallback would be published in this repository, and anyone who read it
could forge an authenticated session.

`DATABASE_URL` is the single source of the connection string for the public API
(`api/lib/db.js`), the admin function and its session store (`api/admin/index.js`).
Everything that touches the URL passes it through `normalizeDatabaseUrl`, whose
implementation lives in `api/lib/db-url.js` so modules that must not open a pool
(`server/db.ts`, `server/routes.ts`, `api/lib/mail-store.js`) can import just the
pure function. `api/lib/db.js` re-exports it for callers that already import it.

It does two things. It drops `channel_binding`: Neon's dashboard appends
`channel_binding=require`, which asks for SCRAM-SHA-256-PLUS, and postgres.js only
implements plain SCRAM-SHA-256, so the parameter must not reach the driver. It
also rewrites `sslmode=prefer|require|verify-ca` to `verify-full`, because
`pg-connection-string` already treats those three as `verify-full` but warns
about them, and that warning reads like a connection failure when it is not.
Writing `verify-full` keeps today's behaviour and silences it. Put the real value
in the deployment environment, never in a tracked file — a connection string in
git is a credential leak even in a private repository, because it survives in
history.

Turnstile is optional and enabled only when `TURNSTILE_SECRET_KEY` is set on the
server. The client mirrors that with `captchaRequired`, derived from
`VITE_TURNSTILE_SITE_KEY`. If you set one, set both, or sign-in will appear broken
in one direction or the other.

### The mailbox can live on its own database

`MAIL_DATABASE_URL` is optional. When it is set, every mail table
(`mail_messages`, `mail_threads`, `mail_attachments`, `mail_drafts`,
`mail_templates`, `mail_signatures`, `mail_notifications`,
`mail_notification_settings`, `push_subscriptions`, `mail_audit_log`) is created
and queried on that database instead of `DATABASE_URL`. Unset — the default —
the mailbox shares the application database and nothing changes. This lets the
mail write volume stay off the application database without a second code path.

`api/lib/mail-store.js` is the only place that reads mail tables, so it owns the
choice. Two consequences are worth knowing before splitting the databases:

- **Foreign keys cannot cross databases.** On a shared database the mail tables
  reference `admin_credentials(id)` with `ON DELETE CASCADE`. On a split one that
  reference is omitted, so deleting an admin does not cascade; the admin delete
  route calls `purgeAdminMailData` for the mail rows instead. It is a no-op on a
  shared database, where the cascade already did the work.
- **Three functions read application tables.** `createMailNotifications`
  (recipient list), `listAudit` (admin pins) and `backfillFromProjectRequests`
  (`project_requests`, `users`) reach across to `DATABASE_URL` through a second
  pooled connection rather than joining. Each stays a bounded number of queries,
  not one per row.

`tests/mail-flow.test.mjs` exercises both shapes: it passes with `DATABASE_URL`
alone and with `MAIL_DATABASE_URL` pointing at a second database.

### Mailjet sending is only successful when Mailjet says so

Every outbound message — password reset and the whole admin mailbox — goes
through one function, `mailjetSend` in `api/lib/email.js`. It posts to the v3.1
Send API with Basic auth built from `MJ_APIKEY_PUBLIC`/`MJ_APIKEY_PRIVATE`, and
the sender comes from `MJ_SENDER_EMAIL` (name from `MJ_SENDER_NAME`).

It counts a send as successful only when Mailjet returns a real, non-zero
`MessageID`. Three shapes look like success and are not: a 200 whose
`Messages[].Status` is `error`; a 200 with an empty `Messages` array; and a
`Status: "success"` with `MessageID: 0` (Sandbox mode, or a sender the account
will not send as). Each is reported as `{ sent: false }`, so a caller can never
claim "sent" for mail that never left the account.

`validateMailjetMessage` runs before the request: a missing/invalid recipient,
sender or subject, or an empty body, is refused as `invalid_message` rather than
posted. Before every request `mailjetSend` logs a `[MAILJET]` line for whether
each key is configured, the recipient and the sender; after it, the HTTP status
and the parsed response. Only those five fields — never a key value, the
Authorization header or a token.

Administrators can exercise the real deployed credentials from the mailbox
settings' Diagnostics tab, which calls `POST /api/admin/mail/mailjet-test`
(behind the same owner/admin `mailGuard`). It sends one minimal message through
the same `mailjetSend` and reports `accepted: true/false` plus the MessageID.
Acceptance is not delivery — the endpoint and its UI copy say so; Mailjet's own
statistics are what report a bounce or a block.

### Admin credentials

Ownership is recovered by running the script against the database rather than
through an emailed link:

```bash
DATABASE_URL='postgres://...' node scripts/reset-owner-pin.mjs
```

It rotates the PIN and password to fresh random values and prints them once.
`--keep-pin` rotates only the password.

### Discord sign-in and linking

Discord is an optional second way in, for both portals. It is enabled only when
`DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set; without them the
handshake redirects back with `not_configured` and the PIN/password form is the
only way in. The callback URL must be absolute, which is why it is derived from
`APP_ORIGIN` and why the start route refuses to build a handshake without one.
Override it with `DISCORD_CALLBACK_URL` (public client) or
`DISCORD_ADMIN_CALLBACK_URL` (admin dashboard) if the two are registered
separately in the Discord application.

A password account and a Discord login that only share an email are two
different identities. Signing in with Discord when the email already belongs to
a password account is refused as `account_exists_requires_link`: silently
matching on the address would let whoever controls that Discord account take
over the ProjectHub account. The account must initiate the link itself, from
`/settings` (client) or `/pbad/settings` (admin), which runs the OAuth handshake
with `mode=link`. Only Discord's own profile response supplies the id that gets
stored — the browser never posts an id — so a forged id cannot attach itself to
a row.

The two rules that keep an account reachable are:

- An account may not unlink its only sign-in method. A Discord-only account is
  offered "set a password" and the unlink button stays disabled until one
  exists; the server enforces the same rule, not just the UI.
- An administrator may only sign in with Discord if their `admin_credentials`
  row already carries that `discord_id`; an unknown Discord account gets
  `admin_not_linked` rather than claiming a row by email.

`discord_id` on `admin_credentials` is added by `ensureAdminSchema` for
deployments that predate it, along with a unique index on the non-null values so
one Discord account maps to one administrator.

Client-facing pages are `/client_profile` (picture, name, email) and `/settings`
(Discord, password, deletion). The email is part of the signed token payload, so
a profile email change makes the server re-issue the token and the client stores
the replacement.

### Desktop mail notifications need VAPID keys

The mailbox can send a browser push notification when mail arrives. It is
enabled only when `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set — without
them `isPushConfigured()` in `api/lib/push.js` returns false and every delivery
is skipped, with the in-dashboard unread badge still working. The public key
also has to reach the client as `VITE_VAPID_PUBLIC_KEY` (or it is embedded the
same way the Turnstile site key is) for a subscription to be created at all.
Generate a pair once and keep it stable: changing the keys invalidates every
stored subscription. The same rules as Mailjet apply — a push is best-effort and
its failure must never fail the mail ingestion that triggered it, and no message
body travels in the payload.
