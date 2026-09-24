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
