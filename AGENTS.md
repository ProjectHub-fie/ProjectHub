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
- `admin-test-runner.test.mjs` — the GitHub Actions dispatch, run matching by
  request id, polling/state transitions, dispatch errors, single-flight, and the
  source guardrails on the route that can trigger CI (no request fields, token
  never exposed, no local Docker/process imports). It exercises the router with a
  mocked GitHub API; no real workflow is ever dispatched during tests.
- `profile-command.test.mjs` — the `&profile` / `&pr` rename, that `&dev` is
  gone, the link-status words, the date/age formatting, and the profile embed
  shape (static author icon, real avatar as the image, relative footer
  timestamp, no `undefined`/`null`/`NaN`).

### The test-runner console

`/pbad/tests` (owner only) runs the repository's `tests/` folder and shows the
workflow's progress and outcome. It is the one dashboard route that triggers
external execution, and it does so on **GitHub Actions**, never on Vercel:
`api/_lib/suite-runner.js` dispatches `.github/workflows/docker-tests.yml` via
the GitHub REST API (a `request_id` it generates server-side is passed as a
workflow input), then polls `GET /actions/workflows/{file}/runs` for the run
whose `display_title` carries that id. The request accepts no input fields at
all; workflow, branch and token all come from process environment defaults.

`tests/` is in `.vercelignore`, so it is not deployed to the serverless function.
The workflow checks out the repository (which includes `tests/`) on a
GitHub-hosted runner and runs the existing `tests` compose service against the
compose database. The image is built with the repository's own `Dockerfile`
via `--build`, so the suite runs in exactly the environment a long-lived host
would use. A `DATABASE_URL_CI` repository variable overrides the integration's
default compose DB URL; `SESSION_SECRET_CI`, `ADMIN_PIN_CI`/`ADMIN_PASSWORD_CI`
secrets override those for the worker (the defaults let the auth/mail tests run
without them). The web deployment itself needs one secret:
`GITHUB_ACTIONS_TOKEN`, scoped to `workflow` dispatch and `actions` read on
`ProjectHub-fie/ProjectHub`.

The endpoint leans on Vercel's 30s `maxDuration` only for the dispatch call —
it never waits for the suite. The dashboard polls `/api/admin/tests/status`
every few seconds; the status handler refreshes the active run from GitHub in
<8s and surfaces the result. A failing suite must make the GitHub job fail, so
the workflow uses `set -o pipefail` and no `continue-on-error`, and the
dashboard reads the run's `conclusion`.

The run's conclusion and its test counts arrive separately, and reading only the
former is why a successful run once displayed no results. GitHub reports
`completed`/`success` but never a test count, so `loadResults()` reads the
`tap-output.tap` artifact the workflow uploads: it lists the run's artifacts,
downloads the ZIP and inflates the entry in memory with `readZipEntry` (an
artifact is always a ZIP; only stored and deflated entries are handled, and a
malformed archive returns null rather than throwing). When the artifact has
expired or the suite uploaded none, it falls back to the job log, whose every
line carries an ISO timestamp that `stripLogTimestamps` removes first. `parseTap`
accepts both reporters — the spec form (`ℹ tests 10`, U+2139) and the TAP form
(`# tests 10`) — and leaves a count `null` rather than guessing when the pattern
does not match, so a reporter change reads as "unknown", not as a wrong number.

A run is marked `completed` a moment before its artifact is downloadable, so the
read is retried on later status polls, bounded by `MAX_RESULT_ATTEMPTS` so a
suite that never uploads an artifact is not re-asked on every page refresh. A
terminal run whose summary still could not be read reports
`resultsUnavailable: true`, and the page says the results are unavailable instead
of showing a success headline over four tiles reading "—".

The compose file carries the app, the bot and a `db`, plus a `tests` service behind
the `tests` profile that runs the suite on demand:

```bash
docker compose build
docker compose run --rm tests        # the suite, against the compose db
```

The `tests` service must declare its own `build: .`, not only `image:`. `docker
compose run --build tests` builds that service's own build block; with just an
`image:` there is nothing to build and compose falls back to *pulling*
`projecthub:local` from a registry, which fails with "pull access denied for
projecthub, repository does not exist". That is invisible on a developer machine
where the image already exists, and fatal on a cold CI runner.

Its command bootstraps the schema before it runs the suite:

```yaml
command:
  - sh
  - -c
  - |
    set -e
    node scripts/db-bootstrap.mjs
    node --test --test-force-exit tests/*.test.mjs
```

The bootstrap is not optional. A fresh compose volume has no tables, and nothing
else creates them: the service depends on `db` only, and `server/index.ts` never
starts, so its `ensure*Schema` helpers never run. Without the bootstrap the
database-backed tests fail with `relation "users" does not exist` — eleven
misleading assertion failures instead of one clear setup error. `set -e` makes a
failed bootstrap stop the run rather than let the suite report on a schema-less
database.

`docker-tests.yml` runs that same service, so it is subject to the same two
rules. The workflow job also has to supply every variable compose declares with
`${VAR:?}` — `SESSION_SECRET` and `DISCORD_BOT_TOKEN` today. Compose interpolates
the whole file before it runs *any* service, so the `bot` service's required
token fails `docker compose config --services` and `docker compose run tests`
alike even though the tests service never receives it. The workflow passes a
fixed literal for the bot token rather than a secret, because no test in that job
reads it and a real token would be a live credential in a job with no use for
one. `tests/admin-test-runner.test.mjs` asserts both properties.

Node 24 rejects a bare directory as a test target — it tries to import it and dies
with `Cannot find module /app/tests` — so the compose `tests` service target is
the glob `tests/*.test.mjs`, the same set `npm test` runs. The workflow only
starts the `tests` service; the command lives in `docker-compose.yml` so a
long-lived host and the dashboard exercise the identical invocation.

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

## Installable utility projects and their downloads

A `verified_projects` row in the `utilities` category may carry application
metadata (`app_version`, `app_size`, `platforms`, `requirements`,
`release_notes`, `screenshots`) and, since the MEGA change, a per-platform
installer: `android_download_url`, `windows_download_url` and a `download_details`
jsonb blob keyed by platform (`package_name`, `version`, `size`, `sha256`,
`notes`). `github_releases_fallback` opts a project into the GitHub Releases link
as an *explicit* fallback; it is no longer assumed.

`isInstallableApp` in `client/src/lib/project-display.ts` is the single switch
between the ordinary project layout and the store-style `app-detail.tsx`. It is
true only for `utilities`, and only when `hasAppMetadata` is true — which now
includes "a per-platform installer link is set", because an app whose only
metadata is a download link is exactly the case the store layout exists for.
`project.tsx` must keep selecting the layout through that helper rather than an
inline category check, and `tests/app-detail.test.mjs` pins it.

### A MEGA link is a credential, so it is validated and never echoed

A MEGA share link carries its decryption key in the URL **fragment**
(`https://mega.nz/file/<id>#<key>`). The link is therefore a secret, and three
rules follow:

- **Validate on the server, not only in the form.** The browser is trivially
  bypassed. `api/_lib/download-links.js` is the boundary; `client/src/lib/download-links.ts`
  is the same logic for fast feedback. They cannot share an import (one is
  TypeScript under `client/`, which is not in the serverless bundle), so
  `tests/download-links.test.mjs` drives both with the same table and fails on any
  disagreement — including the reason string.
- **Never echo the link into a message.** Every rejection reason is a literal
  built from constants; one written as a template literal would publish the key
  into a toast and a log line. `redactDownloadUrl` drops the fragment for any
  diagnostic that must name the link.
- **Require the fragment.** A bare `https://mega.nz/file/<id>` is refused as
  incomplete: it cannot be decrypted by anyone, so storing it produces a download
  button that fails for every visitor.

The trusted-host check is an exact hostname match against `mega.nz`, `www.mega.nz`,
`mega.io` and `mega.co.nz`. A suffix or prefix lookalike (`mega.nz.evil.example`,
`notmega.nz`) must not pass; `isTrustedMegaHost` is compared byte for byte on
both sides.

Both entry points validate: the serverless function and the dev server
(`server/admin-routes.ts`) each call `validateDownloadFields` on **POST and PUT**,
because an update is how a bad link gets in later. An absent field is omitted from
the result rather than set to null, so an edit that does not mention the link
leaves the stored value alone; an explicit `null` is how the dashboard clears one.

### Previous versions are the same credential, one row at a time

A platform's `download_details` entry may carry `previousVersions`: an ordered
list (newest first, capped at `MAX_PREVIOUS_VERSIONS`) of superseded builds, each
`{ version, url, packageName?, size?, releaseDate?, sha256? }`. The `url` is a
MEGA share link and is therefore the same credential as the current one, so it
follows every rule above.

The shape is enforced in three places that must agree:

- `normalizePreviousVersions` keeps a row only when it has **both** a version
  label and a link that passes `validateMegaDownloadUrl`. A row with a label and
  no file, or a file and no label, is dropped — it would otherwise render as a
  dead download on the detail page. The server refuses a *present but invalid*
  link outright (`previousVersionProblem`) rather than dropping it, because a
  silent drop leaves the administrator believing the old build was saved; an
  entirely blank row is not an error, since that is what the form's "Add version"
  button inserts.
- The admin form (`DownloadPlatformFields` in `verified-projects-page.tsx`) edits
  rows and only posts the complete ones, and the page marks an incomplete row as
  "not saved" while it is being typed.
- `app-detail.tsx` renders the list through `previousVersionsFor`, never from the
  raw blob, so a stored row the current rules would reject cannot appear. The list
  is a collapsed `<details>` and renders nothing when empty, so a project without
  an archive looks exactly as it did before the feature. A version is offered only
  for a platform that has a current link — `allPlatformVersions` encodes that — and
  the link is only ever opened, never rendered as text.

`tests/download-links.test.mjs` drives both mirrors with the same table, so a
change to one that is not made to the other fails.

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
role in `&profile`. The start route requires the dashboard session, the callback
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
  function slot and is served as a public endpoint. A helper that only the bot
  needs belongs under `bot/lib/` instead, so the bot's own `npm install` carries
  it (see below).
- `tests/deployment-limits.test.mjs` re-implements Vercel's rule and asserts the
  count and that imports resolve through `_lib`, so this is caught in CI.
- Renaming the directory is safe across all three consumers: the two functions
  import `./_lib` and `../_lib`, and the Express dev server imports `api/_lib` by
  path. Scripts that copy `api/` (`scripts/build-vercel.mjs`) use a recursive copy
  and carry `_lib` with it.

### The Discord bot is a separate process with its own package

`bot/index.js` is the private server bot (`&` prefix, mention replies). It holds
a persistent Discord gateway connection, which a Vercel function cannot do — the
function is request-scoped and capped at 30s in `vercel.json` — so the bot runs
on any host that keeps a process alive (WispByte, VPS, Railway, Fly, Render,
Docker). It is deliberately absent from `vercel.json`; only the control plane is
serverless. Nothing under `api/` imports `discord.js`, so it is not pulled into a
function bundle.

`bot/` is its own package: `bot/package.json` declares only what the bot process
imports (`discord.js`, `debug`, `dotenv`, `postgres`) and `bot/package-lock.json`
is committed, so a bot host installs a few dozen packages instead of the whole
website toolchain. Run it with `cd bot && npm install && node index.js`. The root
`npm run bot` delegates to `npm --prefix bot start`; the root `index.js` launcher
exists only for a host that starts from the repository root and calls the same
`main()`.

The bot's exclusive logic lives under `bot/lib/` — `bot-logic.js`, `bot-store.js`,
`neon-usage.js` and the `roblox-*` modules — because the bot's own install is the
only one that has to resolve them. The dashboard reads them back (`api/_lib/bot-routes.js` imports
`../../bot/lib/...`), and `bot/lib/bot-store.js` imports the one genuinely shared
pure helper, `api/_lib/db-url.js`. The old layout kept all four under `api/_lib`,
which forced a bot-only host to carry the website's `api/` tree and the website's
function bundle to reach into `bot/`.

The split matters when changing this feature: **the dashboard is serverless and
must stay request/response, and only `bot/index.js` may assume a long-lived
process.** Bot logic under `bot/lib` is shared so both halves use the same rules.

The Roblox modules follow the same rule for a sharper reason: `roblox-store.js`
imports `postgres`, and `postgres` is declared in `bot/package.json`, not the
root one. A module the bot imports must therefore sit under `bot/lib`, where Node
resolves `postgres` from `bot/node_modules`. Under `api/_lib` it resolved from
the repo root, found nothing — the bot host installs only `bot/` — and the
process died at load with `ERR_MODULE_NOT_FOUND` before the gateway ever
connected. The only `api/` module the bot may reach into is a pure helper with no
bare imports (`db-url.js`); `tests/deployment-limits.test.mjs` enforces both
directions.

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

`&profile` resolves the caller's Discord id against `admin_credentials.discord_id`
first and `users.discord_id` second, because the same Discord account can be
linked to either portal. An account linked to both is reported as both. A client
whose account is blocked is reported as blocked, never as unlinked.

`&profile` (alias `&pr`) is the profile command, not a developer command. The old
`&dev` command no longer exists as a command or an alias. The reply is one embed:
the author icon is the static brand image, the embed image is the caller's real
Discord avatar (default avatar when they have none) placed above the field list,
and the footer carries the requester plus a Discord relative timestamp so each
reader sees it localized. The per-field values come from the gateway objects where
possible — display name, username, both timestamps — and from the database only
for the three things Discord cannot answer: the site role, the Discord link
status, and who invited the member.

The role is the `admin_credentials.role` when the Discord id is found there, else
`member`; `No Role` is reserved for a lookup that returned nothing. Discord
Linked is `Yes` when the Discord id is found in `users`, otherwise `No` — a
`users` row that merely shares an email was never linked and does not count.
Invite attribution is done by diffing the guild's invite `uses`
counts when a member joins (`bot/events/guildMemberAdd.js`), stored in
`bot_invite_joins` / `bot_invite_uses`, because Discord does not report who used
an invite. A join that cannot be attributed shows `Unknown`, never a raw id.

The message and command handling now lives in `bot/events/messageCreate.js`;
`bot/index.js` is only the process shell (client, usage poll, heartbeat, login).
Both were split so the command surface is testable without a gateway connection.

The bot's activity is `Watching ProjectHub.inc`, set once on `ClientReady`.

The dashboard's "Bot process" tile is a heartbeat, not a token check. The web
deployment's environment can carry `DISCORD_BOT_TOKEN` while the bot host is
dead, so `botTokenConfigured` stays true in exactly the state where nothing
answers `&profile`. The bot process stamps `bot_settings.last_seen_at` (added by
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

## Roblox integration (Bloxlink is the verifier)

The bot does not verify Roblox accounts. Bloxlink owns linking, and the only
value that ever becomes "verified" is a Roblox id returned by Bloxlink's own
server API for a Discord id. A matching username is never evidence of ownership.

The provider layer is `bot/lib/roblox-client.js`, which uses
`GET https://api.blox.link/v4/public/guilds/{guildId}/discord-to-roblox/{discordId}`
with `Authorization: <BLOXLINK_API_KEY>`. Two environment variables enable it and
neither has a default: `BLOXLINK_API_KEY` (a **server** key, valid only for the
guild it was generated for) and `BLOXLINK_GUILD_ID`. The key is read only here,
sent only to Bloxlink, and never logged or returned; the dashboard reports only
whether it is present. Roblox's public endpoints
(`users.roblox.com/v1/usernames/users`, `users/{id}`, and the avatar thumbnail)
answer the *public lookup*, which proves nothing and never sets a verified state.

Four statuses, and the distinction is the whole point: `linked`, `not_linked`
(Bloxlink answered, no account), `verification_unavailable` (no key, wrong guild,
or rate-limited) and `bloxlink_unavailable` (network/5xx). The two unavailable
states must never render as "not linked" — `normalizeStatus` maps anything
unrecognised to `verification_unavailable` for the same reason, so a failure
never reads as a definite no. Command: `&roblox [profile|lookup|verify|unlink|
status]`; a bare `&roblox` is `profile`.

Data lives in three lazily-created tables (`ensureRobloxSchema`):
`roblox_settings` (one row, dashboard-owned, no secrets), `roblox_links` (the
cache — Discord id, Roblox id, status, source, timestamps; deliberately **no**
Roblox payload) and `roblox_link_events` (the log, appended only on a change).
The bot never enumerates the guild: a member is checked once on join
(`bot/events/robloxJoin.js`) and thereafter only on a profile or a Roblox
command, with a TTL on the cache so repeat lookups do not re-ask Bloxlink. An
outage **preserves the last known link** and only restarts the TTL
(`applyLinkResult` calls `touchLinkCheck` instead of `upsertLink`), so it cannot
strip a verified member of access or cause a re-ask per message.

`evaluateFeatureAccess` gates channels/commands: with `requireVerification` on,
a listed channel (or, with no list, every command) requires a linked account,
and staff always pass so an outage cannot lock an administrator out. `&profile`
gains exactly one `🎮 Roblox` field, and only when a link is confirmed and
`showOnProfiles` is on — an unlinked profile is unchanged. The dashboard page is
`/pbad/roblox` (owner/admin, `requireRole('admin')` on the routes in both the
serverless function and the Express server via the shared `buildRobloxRouter`),
with the /roblox sidebar entry hidden for lower roles.

Bloxlink exposes only an account **id**, not usernames, ranks or group info,
through the supported endpoint. Anything beyond the id (username, display name,
avatar, creation date) is filled from Roblox's public API; a Roblox rank or group
claim is **not** invented, and the integration does no group administration or
role sync.
