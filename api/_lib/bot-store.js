/**
 * Configuration and lookup layer for the ProjectHub Discord bot.
 *
 * The bot runs as a separate long-running process (a Discord gateway connection
 * cannot live inside a Vercel serverless function), but everything it needs to
 * know — which channel and webhook to alert, the tier limits, who is who on the
 * site — is configured from the admin portal and stored here. Keeping this in
 * `api/lib` means the serverless dashboard function and the Express dev server
 * read and write the same rows.
 *
 * One table, `bot_settings`, with a single row. It is created lazily by
 * `ensureBotSchema`, following the same convention as `ensureAdminSchema` and
 * `ensureMailSchema`, so a fresh database works without a migration step.
 */
import postgres from 'postgres';
import { normalizeDatabaseUrl, sslOptionForUrl } from './db-url.js';
import { maskWebhook } from './bot-logic.js';

let _sql = null;
function db() {
  _sql ||= postgres(normalizeDatabaseUrl(process.env.DATABASE_URL), { ssl: sslOptionForUrl(process.env.DATABASE_URL), max: 5 });
  return _sql;
}

let schemaReady = null;

/**
 * Creates the bot tables if they are missing.
 *
 * `bot_alert_state` records the last time each metric alerted, so a usage that
 * sits above the threshold does not post on every poll. `last_alerted_at` is
 * jsonb keyed by metric name.
 */
export function ensureBotSchema() {
  schemaReady ||= (async () => {
    const sql = db();
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS bot_settings (
          id text PRIMARY KEY DEFAULT 'default',
          enabled boolean DEFAULT false NOT NULL,
          prefix text DEFAULT '&' NOT NULL,
          alert_channel_id text,
          alert_webhook_url text,
          alert_threshold_percent integer DEFAULT 80 NOT NULL,
          alert_cooldown_minutes integer DEFAULT 360 NOT NULL,
          compute_limit_seconds bigint DEFAULT 360000 NOT NULL,
          storage_limit_bytes bigint DEFAULT 536870912 NOT NULL,
          transfer_limit_bytes bigint DEFAULT 5368709120 NOT NULL,
          project_name text,
          updated_at timestamp DEFAULT now() NOT NULL,
          updated_by uuid
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS bot_alert_state (
          id text PRIMARY KEY DEFAULT 'default',
          last_alerted_at jsonb DEFAULT '{}'::jsonb NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `;
      // Written by the bot process on every poll. Without it the dashboard could
      // only report that a token is configured in the web deployment's
      // environment, which stays true even when the bot process is dead — the
      // exact state where the dashboard looked healthy and the bot was silent.
      await sql`ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS last_seen_at timestamp`;
    } catch (error) {
      schemaReady = null;
      throw error;
    }
  })();
  return schemaReady;
}

/**
 * The dashboard view of the bot configuration.
 *
 * The webhook URL is replaced by a redacted form: it is a credential, and the
 * dashboard only needs to show that one is configured, not the value. The raw
 * URL is available to the bot process through `getBotSettings`.
 */
export async function getBotSettingsForDashboard() {
  const settings = await getBotSettings();
  return {
    enabled: settings.enabled,
    prefix: settings.prefix,
    alertChannelId: settings.alertChannelId,
    webhookConfigured: Boolean(settings.alertWebhookUrl),
    webhookPreview: maskWebhook(settings.alertWebhookUrl),
    alertThresholdPercent: settings.alertThresholdPercent,
    alertCooldownMinutes: settings.alertCooldownMinutes,
    computeLimitSeconds: settings.computeLimitSeconds,
    storageLimitBytes: settings.storageLimitBytes,
    transferLimitBytes: settings.transferLimitBytes,
    projectName: settings.projectName,
    updatedAt: settings.updatedAt,
    // The bot token and Neon API key are never stored here; they are environment
    // configuration, so the dashboard can only report whether they are present.
    botTokenConfigured: Boolean(process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN),
    neonKeyConfigured: Boolean(process.env.NEON_API_KEY),
  };
}

/** The full configuration, including the webhook secret. Bot process only. */
export async function getBotSettings() {
  await ensureBotSchema();
  const sql = db();
  const rows = await sql`SELECT * FROM bot_settings WHERE id = 'default' LIMIT 1`;
  const row = rows[0];
  if (!row) return defaults();
  return {
    enabled: row.enabled,
    prefix: row.prefix || '&',
    alertChannelId: row.alert_channel_id || null,
    alertWebhookUrl: row.alert_webhook_url || null,
    alertThresholdPercent: row.alert_threshold_percent,
    alertCooldownMinutes: row.alert_cooldown_minutes,
    computeLimitSeconds: toNumber(row.compute_limit_seconds),
    storageLimitBytes: toNumber(row.storage_limit_bytes),
    transferLimitBytes: toNumber(row.transfer_limit_bytes),
    projectName: row.project_name || null,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at || null,
  };
}

function defaults() {
  return {
    enabled: false,
    prefix: '&',
    alertChannelId: null,
    alertWebhookUrl: null,
    alertThresholdPercent: 80,
    alertCooldownMinutes: 360,
    computeLimitSeconds: 360000,
    storageLimitBytes: 536870912,
    transferLimitBytes: 5368709120,
    projectName: null,
    updatedAt: null,
    lastSeenAt: null,
  };
}

/**
 * Persists a partial update.
 *
 * Only the fields actually present in `fields` are written, so a dashboard that
 * edits one card cannot blank the others it did not send. `alertWebhookUrl` is
 * special-cased: `undefined` leaves it, `null` or `''` clears it, a string
 * replaces it. That is what lets the UI show a masked value and only send a
 * webhook when the operator actually typed a new one.
 */
export async function saveBotSettings(fields = {}, updatedBy = null) {
  await ensureBotSchema();
  const sql = db();
  const current = await getBotSettings();
  const next = {
    enabled: pick(fields.enabled, current.enabled, Boolean),
    prefix: pick(fields.prefix, current.prefix, (v) => String(v || '&').slice(0, 4)),
    alertChannelId: pick(fields.alertChannelId, current.alertChannelId, (v) => (v ? String(v) : null)),
    alertWebhookUrl: has(fields, 'alertWebhookUrl')
      ? (fields.alertWebhookUrl ? String(fields.alertWebhookUrl) : null)
      : current.alertWebhookUrl,
    alertThresholdPercent: clamp(pick(fields.alertThresholdPercent, current.alertThresholdPercent, Number), 1, 100),
    alertCooldownMinutes: clamp(pick(fields.alertCooldownMinutes, current.alertCooldownMinutes, Number), 0, 10080),
    computeLimitSeconds: Math.max(0, pick(fields.computeLimitSeconds, current.computeLimitSeconds, Number)),
    storageLimitBytes: Math.max(0, pick(fields.storageLimitBytes, current.storageLimitBytes, Number)),
    transferLimitBytes: Math.max(0, pick(fields.transferLimitBytes, current.transferLimitBytes, Number)),
    projectName: pick(fields.projectName, current.projectName, (v) => (v ? String(v).slice(0, 100) : null)),
  };

  await sql`
    INSERT INTO bot_settings (
      id, enabled, prefix, alert_channel_id, alert_webhook_url,
      alert_threshold_percent, alert_cooldown_minutes,
      compute_limit_seconds, storage_limit_bytes, transfer_limit_bytes,
      project_name, updated_by, updated_at
    ) VALUES (
      'default', ${next.enabled}, ${next.prefix}, ${next.alertChannelId}, ${next.alertWebhookUrl},
      ${next.alertThresholdPercent}, ${next.alertCooldownMinutes},
      ${next.computeLimitSeconds}, ${next.storageLimitBytes}, ${next.transferLimitBytes},
      ${next.projectName}, ${updatedBy}::uuid, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      prefix = EXCLUDED.prefix,
      alert_channel_id = EXCLUDED.alert_channel_id,
      alert_webhook_url = EXCLUDED.alert_webhook_url,
      alert_threshold_percent = EXCLUDED.alert_threshold_percent,
      alert_cooldown_minutes = EXCLUDED.alert_cooldown_minutes,
      compute_limit_seconds = EXCLUDED.compute_limit_seconds,
      storage_limit_bytes = EXCLUDED.storage_limit_bytes,
      transfer_limit_bytes = EXCLUDED.transfer_limit_bytes,
      project_name = EXCLUDED.project_name,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `;

  return getBotSettingsForDashboard();
}

/* -------------------------------------------------------------- alert state */

/**
 * The bot process's heartbeat.
 *
 * The web deployment and the bot run in different environments, so the web side
 * cannot observe the bot's process directly. The bot stamps this on every poll
 * and the dashboard reads it back, which is what turns "the token is set" into
 * "the bot actually reached the database recently".
 */
export async function recordBotHeartbeat() {
  await ensureBotSchema();
  const sql = db();
  await sql`
    INSERT INTO bot_settings (id, last_seen_at)
    VALUES ('default', now())
    ON CONFLICT (id) DO UPDATE SET last_seen_at = now()
  `;
}

/** How long without a heartbeat before the bot is reported as not running. */
export const BOT_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Whether the bot process is alive, derived from its last heartbeat.
 *
 * Returns `null` when no heartbeat has ever been recorded, which is different
 * from "stale": a bot that has never started has no last-seen time, and the
 * dashboard should say so rather than showing an arbitrary age.
 */
export async function getBotLiveness() {
  const settings = await getBotSettings();
  const lastSeenAt = settings.lastSeenAt;
  if (!lastSeenAt) return { running: false, lastSeenAt: null, staleAfterMs: BOT_STALE_AFTER_MS };
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  return {
    running: ageMs < BOT_STALE_AFTER_MS,
    lastSeenAt,
    ageMs,
    staleAfterMs: BOT_STALE_AFTER_MS,
  };
}

/** The last-alerted timestamps, keyed by metric. Empty when nothing has fired. */
export async function getAlertState() {
  await ensureBotSchema();
  const sql = db();
  const rows = await sql`SELECT last_alerted_at FROM bot_alert_state WHERE id = 'default' LIMIT 1`;
  return rows[0]?.last_alerted_at || {};
}

/**
 * Merges new metric timestamps into the alert state.
 *
 * Called with the `marks` a successful send produced, so only the metrics that
 * actually fired reset their cooldown.
 */
export async function recordAlertTimes(marks = {}) {
  if (!marks || !Object.keys(marks).length) return;
  await ensureBotSchema();
  const sql = db();
  await sql`
    INSERT INTO bot_alert_state (id, last_alerted_at, updated_at)
    VALUES ('default', ${sql.json(marks)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET
      last_alerted_at = bot_alert_state.last_alerted_at || EXCLUDED.last_alerted_at,
      updated_at = now()
  `;
}

/* ------------------------------------------------------- identity resolution */

/**
 * Resolves a Discord id to the site accounts linked to it.
 *
 * The admin portal is checked first, because `&dev` is specified to report the
 * role an administrator holds there; the public users table is checked second so
 * a client who linked Discord gets an answer too. Both are returned and the
 * caller decides how to present the union.
 *
 * The admin PIN is not selected: `&dev` renders into a public channel, and the
 * PIN is half of the admin login credential.
 */
export async function resolveDiscordIdentity(discordId) {
  await ensureBotSchema();
  const sql = db();

  const [admin] = await sql`
    SELECT id, role, email FROM admin_credentials WHERE discord_id = ${discordId} LIMIT 1
  `;

  const [user] = await sql`
    SELECT id, email, first_name, last_name, username, is_blocked
      FROM users WHERE discord_id = ${discordId} LIMIT 1
  `;

  return {
    admin: admin
      ? { id: admin.id, role: admin.role, email: admin.email }
      : null,
    user: user
      ? {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
          isBlocked: user.is_blocked,
        }
      : null,
  };
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined;
}

function pick(value, fallback, coerce) {
  if (value === undefined) return fallback;
  try {
    const coerced = coerce(value);
    return coerced === undefined || Number.isNaN(coerced) ? fallback : coerced;
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return min;
  return Math.min(max, Math.max(min, amount));
}

function toNumber(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}
