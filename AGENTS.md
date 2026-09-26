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

Always use `--test-force-exit`. `api/_lib/db.js` holds a postgres pool open, which
keeps the event loop alive and otherwise hangs the runner.

`tests/deployment-limits.test.mjs` reads the real `.vercelignore` and matches its
patterns against the real `api/` tree. `.vercelignore` uses gitignore semantics,
where a pattern with no slash matches at *any* depth: a bare `test*` therefore
deleted `api/_lib/test-routes.js` from the deployed bundle while `api/admin/index.js`
still imported it, and the function died at load with `ERR_MODULE_NOT_FOUND`.
Nothing local could see it, because the file is present on disk. Keep every entry
anchored (`/tests/`, `/test*.js`) unless it is genuinely meant to recurse, and note
that a helper under `api/` must not be named `test*` whatever the ignore file says.

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
- `admin-test-runner.test.mjs` — the TAP parser, output capping, and the
  guardrails on the one route that spawns a process. It runs the sibling
  `deployment-limits.test.mjs` for real rather than re-running its own folder,
  which would recurse.

### The test-runner console

`/pbad/tests` (owner only) runs the repository's `tests/` folder and shows the
TAP summary. It is the only route that starts a process, so `api/_lib/suite-runner.js`
builds one fixed argument list and reads no request field at all; the spawn uses
`shell: false`. One run at a time is enforced with a module-level promise.

`tests/` is in `.vercelignore`, so it is not deployed to the serverless function.
The runner therefore has two ways to reach the suite, and reports which one it
used as `mode`:

- **local** — the folder is on disk (a long-lived host, a Docker deployment, local
  development) and the child is this process's own Node.
- **docker** — the folder is absent but a Docker daemon is reachable, so the suite
  runs with `docker run` against an image built from this repository. The image is
  `TEST_RUNNER_IMAGE`, else the compose image `projecthub:local`, else a build of
  `projecthub-tests:local` from the checked-out `Dockerfile`.
- **unavailable** — neither, so `status` says so and a run is a `503` rather than a
  spawn error.

The compose file carries the app, the bot and a `db`, plus a `tests` service behind
the `tests` profile that runs the suite on demand:

```bash
docker compose build
docker compose run --rm tests        # the suite, against the compose db
```

Node 24 rejects a bare directory as a test target — it tries to import it and dies
with `Cannot find module /app/tests` — so the target is the glob `tests/*.test.mjs`,
the same set `npm test` runs. `runTestSuite` takes an optional `target` that only
the tests pass; the HTTP route never does, so a request cannot choose what runs,
and Docker always runs the whole folder.

The spawned child deletes `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` from its
environment. A nested runner that inherits them attaches to the parent's test
protocol instead of emitting TAP, which is what a naive spawn does when the
endpoint is exercised from the suite.

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
(`api/_lib/db.js`), the admin function and its session store (`api/admin/index.js`).
Everything that touches the URL passes it through `normalizeDatabaseUrl`, whose
implementation lives in `api/_lib/db-url.js` so modules that must not open a pool
(`server/db.ts`, `server/routes.ts`, `api/_lib/mail-store.js`) can import just the
pure function. `api/_lib/db.js` re-exports it for callers that already import it.

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

`api/_lib/mail-store.js` is the only place that reads mail tables, so it owns the
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
through one function, `mailjetSend` in `api/_lib/email.js`. It posts to the v3.1
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

Discord is an optional second way in for the **public client only**. It is
enabled only when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set;
without them the handshake redirects back with `not_configured` and the
PIN/password form is the only way in. The callback URL must be absolute, which
is why it is derived from `APP_ORIGIN` and why the start route refuses to build
a handshake without one. Override it with `DISCORD_CALLBACK_URL` (public client)
or `DISCORD_ADMIN_CALLBACK_URL` (admin dashboard) if the two are registered
separately in the Discord application.

Admin linking needs exactly these four, and there is no default for any of them:

| Variable | Why |
| --- | --- |
| `DISCORD_CLIENT_ID` | the Discord application, shared with the public flow |
| `DISCORD_CLIENT_SECRET` | exchanged at the token endpoint; a mismatch is `invalid_client` |
| `APP_ORIGIN` | the public origin; `localhost` is never allow-listed by Discord |
| `DISCORD_ADMIN_CALLBACK_URL` | only to override the derived admin callback URL |

`APP_ORIGIN` must be the origin the browser actually uses, because the derived
callback is `${APP_ORIGIN}/api/admin/auth/discord/callback` and Discord compares
that string against its allow-list twice — once on `/authorize`, and again on the
token exchange, where a mismatch is `invalid_grant` even though the handshake
started fine. Register both callbacks in the application:

```
${APP_ORIGIN}/api/auth/discord/callback        client sign-in
${APP_ORIGIN}/api/admin/auth/discord/callback  admin linking
```

Both backends log every outcome as `[admin-discord] start ...` /
`[admin-discord] callback ...` with a `reason` and, on a token failure, Discord's
own `error` and `error_description`. That line is the diagnosis: `invalid_client`
is the secret, `invalid_grant` is the redirect URI or a reused code, and
`missing_verifier` is a handshake begun in another tab. No secret, token, code or
cookie is ever logged.

A password account and a Discord login that only share an email are two
different identities. Signing in with Discord when the email already belongs to
a password account is refused as `account_exists_requires_link`: silently
matching on the address would let whoever controls that Discord account take
over the ProjectHub account. The account must initiate the link itself, from
`/settings`, which runs the OAuth handshake with `mode=link`. Only Discord's own
profile response supplies the id that gets stored — the browser never posts an
id — so a forged id cannot attach itself to a row.

The two rules that keep an account reachable are:

- An account may not unlink its only sign-in method. A Discord-only account is
  offered "set a password" and the unlink button stays disabled until one
  exists; the server enforces the same rule, not just the UI.
- The client link is the only link that establishes a session.

**Discord is not an admin sign-in.** The dashboard is PIN and password only; the
Discord button that used to sit under the form, and the `mode=link` branch of
the callback that used to mint a dashboard session, are both gone. What remains
is a link: an already-signed-in administrator connects a Discord account from
`/pbad/integrations` so the bot can resolve their `discord_id` and report their
role in `&dev`. The start route requires the dashboard session, the callback
refuses a state that is not `mode: 'link'` and refuses a Discord account already
attached to another administrator, and it only ever writes `discord_id` — it
sets no `isAdminLoggedIn` and no `adminRole`. `/pbad/settings` redirects to
`/pbad/integrations` so old links keep working.

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
them `isPushConfigured()` in `api/_lib/push.js` returns false and every delivery
is skipped, with the in-dashboard unread badge still working. The public key
also has to reach the client as `VITE_VAPID_PUBLIC_KEY` (or it is embedded the
same way the Turnstile site key is) for a subscription to be created at all.
Generate a pair once and keep it stable: changing the keys invalidates every
stored subscription. The same rules as Mailjet apply — a push is best-effort and
its failure must never fail the mail ingestion that triggered it, and no message
body travels in the payload.

### `api/` files are counted as functions, so helpers go in `api/_lib`

Vercel turns **every** file under `api/` into a Serverless Function. The plan
allows 12, and the failure mode is a build error — "exceeded the limit" — not a
warning. `api/lib` reached 15 files when the mail and bot helpers landed and the
deploy failed; that is why the shared helpers now live in `api/_lib`.

A path under `api/` is skipped when it contains `/_`, `/.`, `/node_modules/`, or
ends with `.d.ts`. So `api/_lib` deploys **zero** functions and the directory name
still says what it holds. Only two files are functions: `api/index.js` and
`api/admin/index.js`.

Practical consequences:

- Put a new helper in `api/_lib`, never in `api/` — a file at `api/foo.js` costs a
  function slot and is served as a public endpoint.
- `tests/deployment-limits.test.mjs` re-implements Vercel's rule and asserts the
  count and that imports resolve through `_lib`, so this is caught in CI.
- Renaming the directory is safe across all three consumers: the two functions
  import `./_lib` and `../_lib`, and the Express dev server and bot import
  `api/_lib` by path. Scripts that copy `api/` (`scripts/build-vercel.mjs`) use a
  recursive copy and carry `_lib` with it.

### The Discord bot is a separate process, not a function

`bot/index.js` is the private server bot (`&` prefix, mention replies). It holds
a persistent Discord gateway connection, which a Vercel function cannot do — the
function is request-scoped and capped at 30s in `vercel.json` — so the bot runs
on any host that keeps a process alive (VPS, Railway, Fly, Render, Docker) via
`npm run bot`. It is deliberately absent from `vercel.json`; only the control
plane is serverless. Nothing under `api/` imports `discord.js`, so it is not
pulled into a function bundle.

The split matters when changing this feature: **the dashboard is serverless and
must stay request/response, and only `bot/index.js` may assume a long-lived
process.** Shared logic lives in `api/_lib` so both halves use the same rules.

Configuration is stored, not hardcoded, and is edited at `/pbad/bot` (owner and
admin only, the same `requireRole('admin')` rule as mail):

- `bot_settings` holds one row: enabled flag, prefix, alert channel id, webhook,
  threshold, cooldown, the three tier limits and the project label. Created
  lazily by `ensureBotSchema`, following the `ensureAdminSchema` convention.
- `bot_alert_state.last_alerted_at` is jsonb keyed by metric, and is what stops a
  sustained overage from posting on every poll.

Two secrets are environment-only and are never stored or returned: the bot token
(`DISCORD_BOT_TOKEN`) and the Neon key (`NEON_API_KEY`). The webhook URL *is* a
credential and is stored, but `getBotSettingsForDashboard` masks it via
`maskWebhook` — the browser only ever sees that one is configured. The Neon
project scope (`NEON_PROJECT_IDS`, or the single `NEON_PROJECT_ID`, plus an
optional `NEON_ORG_ID`) is read from the environment rather than the database so
the alert cannot be aimed at a different set of projects by a dashboard write.

The bot token is read from the first of `DISCORD_BOT_TOKEN`, `BOT_TOKEN`,
`DISCORD_TOKEN`, `TOKEN`, `CLIENT_TOKEN` that is set, and the boot banner names
which one won. Five names looks like more than it is: hosts label their secret
fields differently, and a bot that refuses to boot over a naming difference is a
needless outage. `DISCORD_BOT_TOKEN` is still the documented name because it
matches the dashboard's status check. `resolveDiscordToken` returns the source
alongside the value for exactly this reason — with five candidates, "the token is
set" does not identify a host that injected the wrong variable.

`bot/index.js` prints its startup sequence and every gateway transition
(`ShardReady`, `ShardReconnecting`, `ShardResume`, `ShardDisconnect`,
`ShardError`), because "the bot is silent" is otherwise indistinguishable from
"the process never started". Verbose per-event detail goes through `debug` under
`bot:*`, enabled with `BOT_DEBUG` or the standard `DEBUG`. The token is stripped
from that output by `redactToken`, which matches the token shape as well as the
configured value, so a token arriving under a name this process never read cannot
leak; `guardConsole` wraps the console methods so discord.js's own warnings and
stack traces are covered too. discord.js already censors the signature in the
`Provided token:` line it emits, so this is a second layer rather than the only
one.

`&dev` resolves the caller's Discord id against `admin_credentials.discord_id`
first and `users.discord_id` second, because the same Discord account can be
linked to either portal. An account linked to both is reported as both. A client
whose account is blocked is reported as blocked, never as unlinked.

The dashboard's "Bot process" tile is a heartbeat, not a token check. The web
deployment's environment can carry `DISCORD_BOT_TOKEN` while the bot host is
dead, so `botTokenConfigured` stays true in exactly the state where nothing
answers `&dev`. The bot process stamps `bot_settings.last_seen_at` (added by
`ensureBotSchema` for deployments that predate it) on its own one-minute
interval — deliberately not the usage poll's, whose 15-minute default would look
stale against the five-minute `BOT_STALE_AFTER_MS` threshold. `getBotLiveness`
turns that into `running`, and a bot that has never started reports
`lastSeenAt: null` rather than an arbitrary age. The bot host is separate, so
this is the only way the web side can observe it.

The usage alert reads Neon's `consumption_history/v2` endpoint. The scope is
every project in the organization by default, because that is what an
usage-based Neon plan bills; `NEON_PROJECT_IDS` narrows it. `project_ids` is
omitted from the request for the org-wide read, which is what asks Neon for every
project, and the read follows `pagination.cursor` to the end because a partial
page would silently under-report. Consumption is summed across the scope and
`perProject` carries the breakdown that the embed and the dashboard show. Neon
reports what was consumed, not the plan ceiling, so the limits are configured in
the dashboard, default to the Free tier, and are organization-wide ceilings
rather than per-project ones. `evaluateUsage` grades each metric (ok / warning /
critical / exceeded) and the worst one sets the overall level; `shouldAlert` then
applies a per-metric cooldown. Delivery goes to the channel and the webhook
independently, and only metrics that actually reached a destination record their
timestamp — so a total delivery failure retries on the next poll instead of being
silently marked as sent. The embed posted to a webhook pins
`allowed_mentions: { parse: [] }`, since a webhook post can otherwise ping roles.
`POST /api/admin/bot/usage-preview` reads the live figures and evaluates them
*without* sending, which is how "the bot is silent" is told apart from "usage is
genuinely low" from the deployment that is actually running.

The alert is best-effort, the same as Mailjet and push: a failed read or send is
logged and the poll moves on.
