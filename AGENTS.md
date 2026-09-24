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
Both pass it through `normalizeDatabaseUrl` first, which drops `channel_binding`:
Neon's dashboard appends `channel_binding=require`, which asks for
SCRAM-SHA-256-PLUS, and postgres.js only implements plain SCRAM-SHA-256, so the
parameter must not reach the driver. Put the real value in the deployment
environment, never in a tracked file — a connection string in git is a
credential leak even in a private repository, because it survives in history.

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

### Admin credentials

Ownership is recovered by running the script against the database rather than
through an emailed link:

```bash
DATABASE_URL='postgres://...' node scripts/reset-owner-pin.mjs
```

It rotates the PIN and password to fresh random values and prints them once.
`--keep-pin` rotates only the password.
