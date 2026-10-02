/**
 * Storage for the Roblox integration.
 *
 * Three tables, all created lazily by `ensureRobloxSchema`, following the same
 * convention as `ensureBotSchema`/`ensureMailSchema` so a fresh database works
 * without a migration step:
 *
 *   - `roblox_settings`  — one row: the switches an administrator edits in the
 *     dashboard. Nothing secret is stored here; the Bloxlink key is environment
 *     only.
 *   - `roblox_links`     — the cache. One row per Discord member, holding only
 *     the Discord id, the Roblox id Bloxlink reported, the last status, the
 *     source, and when it was last checked. It deliberately stores no Roblox
 *     profile payload — the profile is re-read from Roblox on demand and the
 *     fields are read back through the cache TTL.
 *   - `roblox_link_events` — the log. Appended only on a *change* (link,
 *     unlink, status change, or a Bloxlink failure that prevented a check), so
 *     a member whose link is stable writes nothing on repeat lookups.
 *
 * The dashboard and the bot both use this module. It lives under `bot/lib`
 * because the bot process is what opens the pool: `postgres` is a bot dependency,
 * so a module the bot imports must sit where Node resolves `postgres` from
 * `bot/node_modules`. The serverless function reaches it back through
 * `bot/lib`, the same way it already reaches `bot-store.js` and `db-url.js`.
 */
import postgres from 'postgres';
import { normalizeDatabaseUrl, sslOptionForUrl } from '../../api/_lib/db-url.js';

let _sql = null;
function db() {
  _sql ||= postgres(normalizeDatabaseUrl(process.env.DATABASE_URL), {
    ssl: sslOptionForUrl(process.env.DATABASE_URL),
    max: 5,
  });
  return _sql;
}

let schemaReady = null;

/** Creates the Roblox tables if they are missing. Cached per process. */
export function ensureRobloxSchema() {
  schemaReady ||= (async () => {
    const sql = db();
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS roblox_settings (
          id text PRIMARY KEY DEFAULT 'default',
          enabled boolean DEFAULT false NOT NULL,
          bloxlink_enabled boolean DEFAULT true NOT NULL,
          show_on_profiles boolean DEFAULT true NOT NULL,
          require_verification boolean DEFAULT false NOT NULL,
          verified_only_channels text DEFAULT '' NOT NULL,
          verified_role_id text,
          unverified_role_id text,
          verification_channel_id text,
          notify_on_link boolean DEFAULT true NOT NULL,
          notify_channel_id text,
          display_mode text DEFAULT 'compact' NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL,
          updated_by uuid
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS roblox_links (
          guild_id text NOT NULL,
          discord_id text NOT NULL,
          roblox_id text,
          status text DEFAULT 'not_linked' NOT NULL,
          source text DEFAULT 'bloxlink' NOT NULL,
          last_checked_at timestamp DEFAULT now() NOT NULL,
          linked_at timestamp,
          updated_at timestamp DEFAULT now() NOT NULL,
          PRIMARY KEY (guild_id, discord_id)
        )
      `;
      // The linked-accounts table is read newest-first and filtered by status.
      await sql`CREATE INDEX IF NOT EXISTS roblox_links_linked_at_idx ON roblox_links (linked_at DESC NULLS LAST)`;
      await sql`CREATE INDEX IF NOT EXISTS roblox_links_status_idx ON roblox_links (guild_id, status)`;
      await sql`
        CREATE TABLE IF NOT EXISTS roblox_link_events (
          id bigserial PRIMARY KEY,
          guild_id text,
          discord_id text NOT NULL,
          roblox_id text,
          type text NOT NULL,
          detail text,
          created_at timestamp DEFAULT now() NOT NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS roblox_link_events_created_idx ON roblox_link_events (created_at DESC)`;
    } catch (error) {
      schemaReady = null;
      throw error;
    }
  })();
  return schemaReady;
}

/* ---------------------------------------------------------------- settings */

function defaultSettings() {
  return {
    enabled: false,
    bloxlinkEnabled: true,
    showOnProfiles: true,
    requireVerification: false,
    verifiedOnlyChannels: '',
    verifiedRoleId: null,
    unverifiedRoleId: null,
    verificationChannelId: null,
    notifyOnLink: true,
    notifyChannelId: null,
    displayMode: 'compact',
    updatedAt: null,
  };
}

/** The full configuration. Bot process and dashboard both read this. */
export async function getRobloxSettings() {
  await ensureRobloxSchema();
  const sql = db();
  const [row] = await sql`SELECT * FROM roblox_settings WHERE id = 'default' LIMIT 1`;
  if (!row) return defaultSettings();
  return {
    enabled: row.enabled,
    bloxlinkEnabled: row.bloxlink_enabled,
    showOnProfiles: row.show_on_profiles,
    requireVerification: row.require_verification,
    verifiedOnlyChannels: row.verified_only_channels || '',
    verifiedRoleId: row.verified_role_id || null,
    unverifiedRoleId: row.unverified_role_id || null,
    verificationChannelId: row.verification_channel_id || null,
    notifyOnLink: row.notify_on_link,
    notifyChannelId: row.notify_channel_id || null,
    displayMode: row.display_mode || 'compact',
    updatedAt: row.updated_at,
  };
}

/**
 * The dashboard view of the configuration.
 *
 * Reports only whether the Bloxlink key is *present*, never its value — the same
 * rule the bot and mail settings follow for their secrets.
 */
export async function getRobloxSettingsForDashboard(env = process.env) {
  const settings = await getRobloxSettings();
  return {
    ...settings,
    bloxlinkKeyConfigured: Boolean(String(env.BLOXLINK_API_KEY || '').trim()),
    bloxlinkGuildConfigured: /^\d{15,25}$/.test(String(env.BLOXLINK_GUILD_ID || '').trim()),
  };
}

/**
 * Persists a partial update.
 *
 * Only the fields present are written, so one dashboard card cannot blank
 * another it did not send. Every value is coerced to the shape the column
 * expects; an empty channel id clears it rather than storing `''`.
 */
export async function saveRobloxSettings(fields = {}, updatedBy = null) {
  await ensureRobloxSchema();
  const sql = db();
  const current = await getRobloxSettings();

  const bool = (key, fallback) => (fields[key] === undefined ? fallback : Boolean(fields[key]));
  const idOrNull = (key, fallback) =>
    fields[key] === undefined ? fallback : String(fields[key] || '').trim() || null;

  const next = {
    enabled: bool('enabled', current.enabled),
    bloxlinkEnabled: bool('bloxlinkEnabled', current.bloxlinkEnabled),
    showOnProfiles: bool('showOnProfiles', current.showOnProfiles),
    requireVerification: bool('requireVerification', current.requireVerification),
    verifiedOnlyChannels:
      fields.verifiedOnlyChannels === undefined
        ? current.verifiedOnlyChannels
        : String(fields.verifiedOnlyChannels || '')
            .split(/[\s,]+/)
            .map((id) => id.trim())
            .filter(Boolean)
            .join(','),
    verifiedRoleId: idOrNull('verifiedRoleId', current.verifiedRoleId),
    unverifiedRoleId: idOrNull('unverifiedRoleId', current.unverifiedRoleId),
    verificationChannelId: idOrNull('verificationChannelId', current.verificationChannelId),
    notifyOnLink: bool('notifyOnLink', current.notifyOnLink),
    notifyChannelId: idOrNull('notifyChannelId', current.notifyChannelId),
    displayMode: ['compact', 'full'].includes(fields.displayMode) ? fields.displayMode : current.displayMode,
  };

  await sql`
    INSERT INTO roblox_settings (
      id, enabled, bloxlink_enabled, show_on_profiles, require_verification,
      verified_only_channels, verified_role_id, unverified_role_id,
      verification_channel_id, notify_on_link, notify_channel_id, display_mode,
      updated_by, updated_at
    ) VALUES (
      'default', ${next.enabled}, ${next.bloxlinkEnabled}, ${next.showOnProfiles}, ${next.requireVerification},
      ${next.verifiedOnlyChannels}, ${next.verifiedRoleId}, ${next.unverifiedRoleId},
      ${next.verificationChannelId}, ${next.notifyOnLink}, ${next.notifyChannelId}, ${next.displayMode},
      ${updatedBy}::uuid, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      bloxlink_enabled = EXCLUDED.bloxlink_enabled,
      show_on_profiles = EXCLUDED.show_on_profiles,
      require_verification = EXCLUDED.require_verification,
      verified_only_channels = EXCLUDED.verified_only_channels,
      verified_role_id = EXCLUDED.verified_role_id,
      unverified_role_id = EXCLUDED.unverified_role_id,
      verification_channel_id = EXCLUDED.verification_channel_id,
      notify_on_link = EXCLUDED.notify_on_link,
      notify_channel_id = EXCLUDED.notify_channel_id,
      display_mode = EXCLUDED.display_mode,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `;

  return getRobloxSettingsForDashboard();
}

/* ------------------------------------------------------------------- links */

/** The cached link row for a member, or `null`. */
export async function getCachedLink(guildId, discordId) {
  await ensureRobloxSchema();
  const sql = db();
  const [row] = await sql`
    SELECT * FROM roblox_links WHERE guild_id = ${guildId} AND discord_id = ${discordId} LIMIT 1
  `;
  return row ? mapLink(row) : null;
}

/** The cached link row for a member in any guild, newest first. */
export async function getCachedLinkAnyGuild(discordId) {
  await ensureRobloxSchema();
  const sql = db();
  const [row] = await sql`
    SELECT * FROM roblox_links WHERE discord_id = ${discordId}
    ORDER BY last_checked_at DESC LIMIT 1
  `;
  return row ? mapLink(row) : null;
}

/**
 * Writes a link result.
 *
 * `linkedAt` is set once, the first time a link is observed, and preserved
 * across later refreshes so the "Linked" column shows when the account was first
 * seen rather than when it was last re-checked. A row that transitions away from
 * linked clears it.
 */
export async function upsertLink({ guildId, discordId, robloxId = null, status = 'not_linked', source = 'bloxlink' } = {}) {
  await ensureRobloxSchema();
  const sql = db();
  await sql`
    INSERT INTO roblox_links (guild_id, discord_id, roblox_id, status, source, last_checked_at, linked_at, updated_at)
    VALUES (
      ${guildId}, ${discordId}, ${robloxId}, ${status}, ${source}, now(),
      ${status === 'linked' ? new Date() : null}, now()
    )
    ON CONFLICT (guild_id, discord_id) DO UPDATE SET
      roblox_id = EXCLUDED.roblox_id,
      status = EXCLUDED.status,
      source = EXCLUDED.source,
      last_checked_at = now(),
      linked_at = CASE
        WHEN EXCLUDED.status = 'linked' THEN COALESCE(roblox_links.linked_at, now())
        ELSE NULL
      END,
      updated_at = now()
  `;
}

/**
 * Bumps a row's check timestamp without changing its status.
 *
 * Used when a check could not be answered: the last known link is preserved and
 * the TTL restarts, so an outage does not strip a verified member or hammer
 * Bloxlink once per message while it recovers.
 */
export async function touchLinkCheck(guildId, discordId) {
  await ensureRobloxSchema();
  const sql = db();
  await sql`
    UPDATE roblox_links SET last_checked_at = now(), updated_at = now()
    WHERE guild_id = ${guildId} AND discord_id = ${discordId}
  `;
}

/** Appends a log entry. Called only when something actually changed. */
export async function recordLinkEvent({ guildId = null, discordId, robloxId = null, type, detail = null } = {}) {
  await ensureRobloxSchema();
  const sql = db();
  await sql`
    INSERT INTO roblox_link_events (guild_id, discord_id, roblox_id, type, detail)
    VALUES (${guildId}, ${discordId}, ${robloxId}, ${type}, ${detail})
  `;
}

/**
 * Applies a fresh Bloxlink result to the cache and logs the transition.
 *
 * The event is written only when the status or the Roblox id changed, so a
 * member opening their profile repeatedly does not grow the log or the database
 * write count. Returns the transition so the caller can fire a notification.
 *
 * A result we could not answer — `verification_unavailable` or
 * `bloxlink_unavailable` — never overwrites a known link. The existing row keeps
 * its status and only its check timestamp moves, so a Bloxlink outage cannot
 * strip a verified member of their link or access, and cannot make the bot
 * re-ask Bloxlink on every message while the outage lasts. When there is no
 * prior row, the unavailable status *is* stored, because then it is the only
 * information there is.
 *
 * `guildId` may be absent (a DM, or a fetch outside a guild); the row is then
 * keyed under an empty guild, which still caches the answer.
 */
export async function applyLinkResult({ guildId = '', discordId, result = {}, notify = true } = {}) {
  const previous = await getCachedLink(guildId || '', discordId);
  const status = result.status || 'not_linked';
  const robloxId = result.robloxId || null;
  const unavailable = status === 'bloxlink_unavailable' || status === 'verification_unavailable';

  if (unavailable && previous) {
    await touchLinkCheck(guildId || '', discordId);
    if (previous.status !== status) {
      await recordLinkEvent({
        guildId: guildId || null,
        discordId,
        robloxId: previous.robloxId || null,
        type: 'bloxlink_failure',
        detail: status,
      });
      return { changed: true, eventType: 'bloxlink_failure', previous, status: previous.status, robloxId: previous.robloxId };
    }
    return { changed: false, eventType: null, previous, status: previous.status, robloxId: previous.robloxId };
  }

  const changed = !previous || previous.status !== status || previous.robloxId !== robloxId;
  await upsertLink({ guildId: guildId || '', discordId, robloxId, status, source: result.source || 'bloxlink' });

  let eventType = null;
  if (changed) {
    if (status === 'linked') eventType = previous && previous.status === 'linked' ? 'status_change' : 'linked';
    else if (previous && previous.status === 'linked') eventType = 'unlinked';
    else if (status === 'not_linked') eventType = previous ? 'status_change' : null;
    else eventType = 'bloxlink_failure';

    if (eventType) {
      await recordLinkEvent({
        guildId: guildId || null,
        discordId,
        robloxId,
        type: eventType,
        detail: status,
      });
    }
  }

  if (!notify && eventType === 'bloxlink_failure') return { changed, eventType: null, previous, status, robloxId };
  return { changed, eventType, previous, status, robloxId };
}

/** A page of cached links, newest linked first. */
export async function listLinks({ guildId = null, status = null, limit = 100, offset = 0 } = {}) {
  await ensureRobloxSchema();
  const sql = db();
  const rows = await sql`
    SELECT * FROM roblox_links
    WHERE (${guildId}::text IS NULL OR guild_id = ${guildId})
      AND (${status}::text IS NULL OR status = ${status})
    ORDER BY linked_at DESC NULLS LAST, last_checked_at DESC
    LIMIT ${Math.min(500, Math.max(1, Number(limit) || 100))}
    OFFSET ${Math.max(0, Number(offset) || 0)}
  `;
  return rows.map(mapLink);
}

/** Recent log entries, newest first. */
export async function listLinkEvents({ limit = 50, type = null, discordId = null } = {}) {
  await ensureRobloxSchema();
  const sql = db();
  const rows = await sql`
    SELECT * FROM roblox_link_events
    WHERE (${type}::text IS NULL OR type = ${type})
      AND (${discordId}::text IS NULL OR discord_id = ${discordId})
    ORDER BY created_at DESC
    LIMIT ${Math.min(500, Math.max(1, Number(limit) || 50))}
  `;
  return rows.map((row) => ({
    id: String(row.id),
    guildId: row.guild_id,
    discordId: row.discord_id,
    robloxId: row.roblox_id,
    type: row.type,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

/**
 * The headline statistics.
 *
 * Only figures the cache can actually answer are returned. The counts are over
 * *cached* members, which is stated in the UI: the bot never polls every member,
 * so "unlinked" means "checked and found unlinked", not "every silent member".
 */
export async function getRobloxStats({ guildId = null } = {}) {
  await ensureRobloxSchema();
  const sql = db();
  const [counts] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'linked')::int AS linked,
      COUNT(*) FILTER (WHERE status = 'not_linked')::int AS unlinked,
      COUNT(*) FILTER (WHERE status IN ('verification_unavailable', 'bloxlink_unavailable'))::int AS unavailable,
      COUNT(*)::int AS tracked
    FROM roblox_links
    WHERE (${guildId}::text IS NULL OR guild_id = ${guildId})
  `;
  const [events] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE type = 'linked')::int AS links,
      COUNT(*) FILTER (WHERE type = 'unlinked')::int AS unlinks,
      COUNT(*) FILTER (WHERE type = 'bloxlink_failure')::int AS failures
    FROM roblox_link_events
  `;
  const recent = await sql`
    SELECT discord_id, roblox_id, created_at FROM roblox_link_events
    WHERE type = 'linked' ORDER BY created_at DESC LIMIT 5
  `;
  const [newToday] = await sql`
    SELECT COUNT(*)::int AS n FROM roblox_link_events
    WHERE type = 'linked' AND created_at >= now() - interval '24 hours'
  `;
  return {
    tracked: counts.tracked,
    linked: counts.linked,
    unlinked: counts.unlinked,
    unavailable: counts.unavailable,
    // A link is a verified link: Bloxlink is the verifier.
    verified: counts.linked,
    totalLinks: events.links,
    totalUnlinks: events.unlinks,
    failures: events.failures,
    linkedLast24h: newToday.n,
    recent: recent.map((row) => ({
      discordId: row.discord_id,
      robloxId: row.roblox_id,
      at: row.created_at,
    })),
  };
}

function mapLink(row) {
  return {
    guildId: row.guild_id,
    discordId: row.discord_id,
    robloxId: row.roblox_id,
    status: row.status,
    source: row.source,
    lastCheckedAt: row.last_checked_at,
    linkedAt: row.linked_at,
    updatedAt: row.updated_at,
  };
}
