# ProjectHub Discord bot

The private server bot. Prefix `&`, replies to mentions, reports site roles with
`&dev`, and posts a Neon usage alert when a database metric crosses its tier
threshold.

## Why it runs separately

This is a **long-running process**, not a serverless function. It holds a
persistent Discord gateway connection, and the ProjectHub web deployment is on
Vercel, whose functions are request-scoped and capped at 30 seconds. So the bot
runs anywhere that keeps a process alive — a VPS, Railway, Fly, Render, Docker,
or a small always-on box — while the web app stays on Vercel as it is.

Only the configuration lives in the web app. Everything shared between the two
halves is in `api/_lib`, so there is one definition of the alert rules.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | yes | The bot account's token. Enable **Message Content Intent** in the Discord developer portal, or prefix commands and mentions will not arrive. |
| `DATABASE_URL` | yes | The same database the web app uses. The bot reads its configuration and resolves roles from it. |
| `NEON_API_KEY` | for usage alerts | A Neon API key with access to the organization's projects. |
| `NEON_PROJECT_IDS` | no | Comma-separated project ids to measure. Unset, the alert measures **every project in the organization**. |
| `NEON_PROJECT_ID` | no | A single project id, for when `NEON_PROJECT_IDS` is not set. Both unset means every project. |
| `NEON_ORG_ID` | no | Restricts an organization-wide read to one organization. |
| `BOT_POLL_INTERVAL_MINUTES` | no | How often to check usage. Default `15`. |
| `MAIL_DATABASE_URL` | no | Only if the mailbox was split onto its own database. |

The bot token and the Neon key are never stored in the database and never
returned by an API endpoint. The Discord webhook URL is different: it is a
credential too, so it is stored but masked when the dashboard reads it back.

## Running

```bash
npm install
npm run bot        # or: npm run bot:dev, to load .env
```

The process signs in and then stamps `bot_settings.last_seen_at` every minute.
That heartbeat is what the dashboard's **Bot process** tile reads: it is the only
way the web deployment can tell a running bot from a configured-but-dead one,
because `DISCORD_BOT_TOKEN` lives in the web environment too. If the tile says
the bot is not running while the token is set, the process on the bot host has
stopped or never started — check that host's logs for the `[bot] signed in as ...`
line.

## WispByte setup

The web app stays on Vercel and the persistent Discord bot runs on WispByte.
Upload the **whole repository** to WispByte, not only `bot/index.js`: the bot
imports `api/_lib/bot-store.js`, `api/_lib/bot-logic.js`, and the database URL
helper.

1. Create a WispByte server with the **Node.js** image. Use Node 20 or newer.
2. Upload the repository, including `package.json`, `package-lock.json`,
   `bot/`, `api/`, and `dataconnect-generated/`.
3. Upload `package.json` and `package-lock.json`, then install the bot's
   production dependencies:

   ```bash
   npm install --omit=dev --no-audit --no-fund
   ```

   If WispByte's **Additional Node Packages** field is used instead, add
   `discord.js dotenv postgres`.
4. Set the WispByte startup command to `node index.js` (or
   `node bot/index.js`).
5. Add these environment variables in WispByte's Startup settings:

   | Name | Required | Value |
   | --- | --- | --- |
   | `DISCORD_BOT_TOKEN` | yes | The bot token from Discord Developer Portal |
   | `DATABASE_URL` | yes | The same PostgreSQL/Neon URL used by the web app |
   | `NEON_API_KEY` | no | Required only for Neon usage alerts |
   | `NEON_PROJECT_IDS` | no | Optional comma-separated Neon project ids |
   | `NEON_ORG_ID` | no | Optional Neon organization id |
   | `BOT_POLL_INTERVAL_MINUTES` | no | Optional interval, default `15` |

   `BOT_TOKEN` is also accepted as an alias for `DISCORD_BOT_TOKEN`, but
   `DISCORD_BOT_TOKEN` is recommended because it matches the dashboard status
   check and the rest of this project.

6. In the Discord Developer Portal, enable **Message Content Intent** for the
   bot. Give it permission to view channels, read message history, send
   messages, and embed links.
7. Start the server and check the console for:

   ```text
   [bot] signed in as ...
   ```

   If the console says a required environment variable is missing, fix that
   variable in WispByte's Startup settings and restart the server.

Do not put the Discord token or database URL in a committed `.env` file. Use
WispByte's environment-variable fields.

### Connecting WispByte to the Vercel web app

The bot and Vercel must use the same `DATABASE_URL`. The Vercel web app's
admin page stores the bot configuration in that database; the WispByte bot
reads it from there every minute. After the web app is running:

1. Open `/pbad/bot` in the web app.
2. Enable the bot and set its prefix, alert channel/webhook, and Neon limits.
3. For the Vercel dashboard's status card and usage-preview action to show
   green, add `DISCORD_BOT_TOKEN` and `NEON_API_KEY` to the Vercel project's
   server environment too. Store them as encrypted environment variables; do
   not put them in the browser or database. The bot still reads the same
   values from WispByte's Startup settings.
4. Restart only if the bot process was stopped; configuration changes are
   picked up automatically.

The dashboard/API continues to run on Vercel; no Discord gateway connection is
placed in the Vercel function.

On a host that restarts the process on every boot, the panel usually runs
`npm install` itself before starting `node bot/index.js`. A full install pulls
the whole frontend toolchain plus the `vercel` and `gh` CLIs, which is well past
the memory a small container gets, and the kernel kills it — the log shows `Killed
npm install`, and the bot then dies with `Cannot find package 'discord.js'` even
though `discord.js` is declared. Install production dependencies only:

```bash
npm run bot:prod-install   # npm install --omit=dev
```

That is ~700 packages instead of ~1100, with `discord.js` present and no build
tools. Use Node 20 or newer: `package.json` declares `engines.node >= 20`, and
`discord.js` uses `node:`-prefixed built-ins that Node 18 and older reject.

Run it under a supervisor (`systemd`, `pm2`, or the platform's restart policy) so
it comes back after a crash or a host reboot.

## Configuration

Everything operational is set in the admin dashboard at **`/pbad/bot`** (owner
and admin only), not in code:

- enable/disable and the command prefix
- the alert channel id and/or webhook URL
- the alert threshold and the cooldown between repeats
- the Neon tier limits the alert compares against

The bot re-reads this every minute, so a change takes effect without a restart.

The **Usage check** button on that page reads the live Neon figures and shows
what the alert would decide *without sending anything* — use it to confirm the
key, the scope and the limits are right. It also lists the projects that
contributed the most compute, so a shared quota can be traced to a project.

## Commands

| Command | Behaviour |
| --- | --- |
| `&dev` | Reports the caller's ProjectHub role, resolved from the Discord account linked in the admin portal (or the client portal). |
| `&help` | Lists the commands. |
| `@mention` | Same as `&dev`; `@mention dev` works too, and an unknown command after a mention gets an error rather than silence. |

An unlinked Discord account is told how to link rather than being ignored. There
is no `&dev` for an account that has not linked, by design — the link is what
proves the identity.

## Threshold limits

Neon's consumption API reports what was consumed, not the plan ceiling, so the
limits are entered in the dashboard. The defaults match the Free tier; set them to
the plan the organization is actually on.

Usage is summed across every project in the organization by default, so these are
**organization-wide ceilings**, not per-project ones — which matches how Neon's
usage-based plans bill. Set `NEON_PROJECT_IDS` to measure a subset instead. A
limit of `0` means "unknown" for that metric and it never alerts.
