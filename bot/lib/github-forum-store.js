/**
 * Storage for the Discord Forum ↔ GitHub Issues integration.
 *
 * Seven tables, all created lazily by `ensureGithubForumSchema`, following the
 * same convention as `ensureBotSchema`/`ensureRobloxSchema`/`ensureMailSchema`
 * so a fresh database works without a migration step. They share the one
 * application database; no second database is introduced.
 *
 *   - `github_forum_settings`             one row: the switches and the Forum
 *                                          channel the administrator edits.
 *   - `github_forum_repository_mappings` one row per Discord tag -> repository.
 *                                          The tag *id* is stored, not only the
 *                                          name, because a name can be renamed.
 *   - `github_forum_issue_links`         one row per Forum thread: the thread,
 *                                          its starter message, and the GitHub
 *                                          issue it became.
 *   - `github_forum_message_links`       one row per synced message, keyed by
 *                                          the Discord message id *and* the
 *                                          GitHub comment id, so a duplicate
 *                                          event in either direction is a no-op.
 *   - `github_forum_sync_queue`          the persistent job queue.
 *   - `github_forum_sync_logs`           the append-only activity log.
 *   - `github_forum_webhook_deliveries`  the webhook dedupe ledger.
 *
 * It lives under `bot/lib` for the same reason the Roblox store does: it imports
 * `postgres`, which is a *bot* dependency, so the bot's own install has to be the
 * one that resolves it. The serverless function reaches it back through
 * `bot/lib`, exactly as it does `bot-store.js` and `roblox-store.js`.
 *
 * Idempotency is in the database, never in memory: a unique constraint on the
 * Discord message id and one on the GitHub comment id mean a redelivered event
 * cannot create a second row, and the queue's claim is a single atomic UPDATE.
 */
import postgres from 'postgres';
import { normalizeDatabaseUrl, sslOptionForUrl } from '../../api/_lib/db-url.js';
import {
  JOB_STATUS,
  JOB_TYPE,
  ISSUE_STATE,
  MAX_JOB_ATTEMPTS,
  nextRetryDelay,
  isJobExhausted,
} from './github-forum-logic.js';

let _sql = null;
function db() {
  _sql ||= postgres(normalizeDatabaseUrl(process.env.DATABASE_URL), {
    ssl: sslOptionForUrl(process.env.DATABASE_URL),
    max: 5,
  });
  return _sql;
}

let schemaReady = null;

/** Creates the integration tables if they are missing. Cached per process. */
export function ensureGithubForumSchema() {
  schemaReady ||= (async () => {
    const sql = db();
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS github_forum_settings (
          id text PRIMARY KEY DEFAULT 'default',
          enabled boolean DEFAULT false NOT NULL,
          guild_id text,
          forum_channel_id text,
          sync_discord_to_github boolean DEFAULT true NOT NULL,
          sync_github_to_discord boolean DEFAULT true NOT NULL,
          create_issues boolean DEFAULT true NOT NULL,
          notify_state_changes boolean DEFAULT true NOT NULL,
          sync_attachments boolean DEFAULT true NOT NULL,
          issue_labels text DEFAULT '' NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL,
          updated_by uuid
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS github_forum_repository_mappings (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          discord_tag_id text NOT NULL,
          discord_tag_name text,
          github_owner text NOT NULL,
          github_repository text NOT NULL,
          enabled boolean DEFAULT true NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL,
          updated_by uuid
        )
      `;
      // A tag maps to exactly one repository. The unique index is what makes a
      // duplicate tag mapping impossible, not only the dashboard's check.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS github_forum_mappings_tag_idx
        ON github_forum_repository_mappings (discord_tag_id)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS github_forum_issue_links (
          discord_thread_id text PRIMARY KEY NOT NULL,
          discord_starter_message_id text,
          discord_guild_id text,
          github_repository text NOT NULL,
          github_owner text NOT NULL,
          github_repo text NOT NULL,
          github_issue_number integer NOT NULL,
          github_issue_id bigint,
          github_issue_url text,
          issue_state text DEFAULT 'open' NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `;
      // A GitHub issue must not be linked from two Discord threads.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS github_forum_issue_links_repo_issue_idx
        ON github_forum_issue_links (github_repository, github_issue_number)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS github_forum_issue_links_repo_idx
        ON github_forum_issue_links (github_repository, issue_state)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS github_forum_message_links (
          id bigserial PRIMARY KEY,
          discord_message_id text NOT NULL,
          discord_thread_id text NOT NULL,
          github_repository text NOT NULL,
          github_issue_number integer NOT NULL,
          github_comment_id bigint,
          direction text NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL
        )
      `;
      // One Discord message becomes at most one GitHub comment...
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS github_forum_message_links_discord_idx
        ON github_forum_message_links (discord_message_id, direction)
      `;
      // ...and one GitHub comment becomes at most one Discord reply.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS github_forum_message_links_comment_idx
        ON github_forum_message_links (github_comment_id)
        WHERE github_comment_id IS NOT NULL
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS github_forum_message_links_thread_idx
        ON github_forum_message_links (discord_thread_id)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS github_forum_sync_queue (
          id bigserial PRIMARY KEY,
          event_type text NOT NULL,
          payload jsonb DEFAULT '{}'::jsonb NOT NULL,
          status text DEFAULT 'pending' NOT NULL,
          attempts integer DEFAULT 0 NOT NULL,
          max_attempts integer DEFAULT ${sql.unsafe(String(MAX_JOB_ATTEMPTS))} NOT NULL,
          next_attempt_at timestamp DEFAULT now() NOT NULL,
          last_error text,
          locked_at timestamp,
          dedupe_key text,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `;
      // The dedupe key is what stops an event delivered twice from being queued
      // twice; NULL keys are unconstrained, so only jobs that carry one dedupe.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS github_forum_sync_queue_dedupe_idx
        ON github_forum_sync_queue (dedupe_key)
        WHERE dedupe_key IS NOT NULL
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS github_forum_sync_queue_ready_idx
        ON github_forum_sync_queue (status, next_attempt_at)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS github_forum_sync_logs (
          id bigserial PRIMARY KEY,
          event_id text,
          event_type text NOT NULL,
          source text,
          destination text,
          repository text,
          issue_number integer,
          status text NOT NULL,
          direction text,
          attempts integer DEFAULT 0 NOT NULL,
          error_summary text,
          detail jsonb,
          created_at timestamp DEFAULT now() NOT NULL
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS github_forum_sync_logs_created_idx
        ON github_forum_sync_logs (created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS github_forum_sync_logs_status_idx
        ON github_forum_sync_logs (status)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS github_forum_webhook_deliveries (
          delivery_id text PRIMARY KEY NOT NULL,
          event_type text,
          action text,
          processing_status text DEFAULT 'received' NOT NULL,
          received_at timestamp DEFAULT now() NOT NULL,
          processed_at timestamp,
          note text
        )
      `;
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
    guildId: null,
    forumChannelId: null,
    syncDiscordToGithub: true,
    syncGithubToDiscord: true,
    createIssues: true,
    notifyStateChanges: true,
    syncAttachments: true,
    issueLabels: '',
    updatedAt: null,
  };
}

/** The full configuration. Bot process and dashboard both read this. */
export async function getGithubForumSettings() {
  await ensureGithubForumSchema();
  const sql = db();
  const [row] = await sql`SELECT * FROM github_forum_settings WHERE id = 'default' LIMIT 1`;
  if (!row) return defaultSettings();
  return {
    enabled: row.enabled,
    guildId: row.guild_id || null,
    forumChannelId: row.forum_channel_id || null,
    syncDiscordToGithub: row.sync_discord_to_github,
    syncGithubToDiscord: row.sync_github_to_discord,
    createIssues: row.create_issues,
    notifyStateChanges: row.notify_state_changes,
    syncAttachments: row.sync_attachments,
    issueLabels: row.issue_labels || '',
    updatedAt: row.updated_at,
  };
}

/**
 * The dashboard view.
 *
 * Reports only whether each GitHub App secret is *present*, never its value —
 * the same rule the bot, mail and Roblox settings follow. The private key and
 * the webhook secret are environment-only.
 */
export async function getGithubForumSettingsForDashboard(env = process.env) {
  const settings = await getGithubForumSettings();
  return {
    ...settings,
    issueLabels: parseLabels(settings.issueLabels),
    appIdConfigured: Boolean(String(env.GITHUB_APP_ID || '').trim()),
    privateKeyConfigured: Boolean(String(env.GITHUB_APP_PRIVATE_KEY || '').trim()),
    installationIdConfigured: Boolean(String(env.GITHUB_APP_INSTALLATION_ID || '').trim()),
    webhookSecretConfigured: Boolean(String(env.GITHUB_WEBHOOK_SECRET || '').trim()),
  };
}

/** Splits the stored label list into a clean array. */
export function parseLabels(value) {
  if (Array.isArray(value)) return value.map((label) => String(label).trim()).filter(Boolean);
  return String(value || '')
    .split(/[,\n]/)
    .map((label) => label.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Persists a partial update.
 *
 * Only the fields present are written, so one dashboard card cannot blank
 * another. An empty channel id clears it rather than storing `''`.
 */
export async function saveGithubForumSettings(fields = {}, updatedBy = null) {
  await ensureGithubForumSchema();
  const sql = db();
  const current = await getGithubForumSettings();

  const bool = (key, fallback) => (fields[key] === undefined ? fallback : Boolean(fields[key]));
  const idOrNull = (key, fallback) =>
    fields[key] === undefined ? fallback : String(fields[key] || '').trim() || null;

  const next = {
    enabled: bool('enabled', current.enabled),
    guildId: idOrNull('guildId', current.guildId),
    forumChannelId: idOrNull('forumChannelId', current.forumChannelId),
    syncDiscordToGithub: bool('syncDiscordToGithub', current.syncDiscordToGithub),
    syncGithubToDiscord: bool('syncGithubToDiscord', current.syncGithubToDiscord),
    createIssues: bool('createIssues', current.createIssues),
    notifyStateChanges: bool('notifyStateChanges', current.notifyStateChanges),
    syncAttachments: bool('syncAttachments', current.syncAttachments),
    issueLabels: fields.issueLabels === undefined ? current.issueLabels : parseLabels(fields.issueLabels).join(','),
  };

  await sql`
    INSERT INTO github_forum_settings (
      id, enabled, guild_id, forum_channel_id, sync_discord_to_github, sync_github_to_discord,
      create_issues, notify_state_changes, sync_attachments, issue_labels, updated_by, updated_at
    ) VALUES (
      'default', ${next.enabled}, ${next.guildId}, ${next.forumChannelId}, ${next.syncDiscordToGithub}, ${next.syncGithubToDiscord},
      ${next.createIssues}, ${next.notifyStateChanges}, ${next.syncAttachments}, ${next.issueLabels}, ${updatedBy}::uuid, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      guild_id = EXCLUDED.guild_id,
      forum_channel_id = EXCLUDED.forum_channel_id,
      sync_discord_to_github = EXCLUDED.sync_discord_to_github,
      sync_github_to_discord = EXCLUDED.sync_github_to_discord,
      create_issues = EXCLUDED.create_issues,
      notify_state_changes = EXCLUDED.notify_state_changes,
      sync_attachments = EXCLUDED.sync_attachments,
      issue_labels = EXCLUDED.issue_labels,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `;

  return getGithubForumSettingsForDashboard();
}

/* -------------------------------------------------------------- mappings */

function mapMapping(row) {
  return {
    id: row.id,
    discordTagId: row.discord_tag_id,
    discordTagName: row.discord_tag_name || null,
    githubOwner: row.github_owner,
    githubRepository: row.github_repository,
    repository: `${row.github_owner}/${row.github_repository}`,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every mapping, enabled and disabled, newest first. */
export async function listMappings() {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`SELECT * FROM github_forum_repository_mappings ORDER BY created_at ASC`;
  return rows.map(mapMapping);
}

/** Only the enabled mappings, which is what the resolver reads. */
export async function listEnabledMappings() {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    SELECT * FROM github_forum_repository_mappings WHERE enabled = true ORDER BY created_at ASC
  `;
  return rows.map(mapMapping);
}

/** The mapping for a tag id, or `null`. */
export async function getMappingByTag(tagId) {
  await ensureGithubForumSchema();
  const sql = db();
  const [row] = await sql`
    SELECT * FROM github_forum_repository_mappings WHERE discord_tag_id = ${String(tagId)} LIMIT 1
  `;
  return row ? mapMapping(row) : null;
}

/**
 * Creates or updates a mapping.
 *
 * The unique index on the tag id is the authority: a second mapping for the same
 * tag fails here even if the dashboard's check is bypassed. The error is
 * translated into a clear message rather than a raw driver error.
 */
export async function upsertMapping(fields = {}, updatedBy = null) {
  await ensureGithubForumSchema();
  const sql = db();
  const tagId = String(fields.discordTagId || '').trim();
  const owner = String(fields.githubOwner || '').trim();
  const repository = String(fields.githubRepository || '').trim();
  const tagName = fields.discordTagName ? String(fields.discordTagName).trim().slice(0, 100) : null;
  const enabled = fields.enabled === undefined ? true : Boolean(fields.enabled);

  try {
    if (fields.id) {
      const rows = await sql`
        UPDATE github_forum_repository_mappings SET
          discord_tag_id = ${tagId},
          discord_tag_name = ${tagName},
          github_owner = ${owner},
          github_repository = ${repository},
          enabled = ${enabled},
          updated_by = ${updatedBy}::uuid,
          updated_at = now()
        WHERE id = ${fields.id}::uuid
        RETURNING *
      `;
      if (!rows[0]) return { ok: false, reason: 'not_found' };
      return { ok: true, mapping: mapMapping(rows[0]) };
    }

    const rows = await sql`
      INSERT INTO github_forum_repository_mappings
        (discord_tag_id, discord_tag_name, github_owner, github_repository, enabled, updated_by)
      VALUES (${tagId}, ${tagName}, ${owner}, ${repository}, ${enabled}, ${updatedBy}::uuid)
      RETURNING *
    `;
    return { ok: true, mapping: mapMapping(rows[0]) };
  } catch (error) {
    if (String(error?.code) === '23505' || /duplicate key/i.test(String(error?.message))) {
      return { ok: false, reason: 'duplicate_tag' };
    }
    throw error;
  }
}

/** Removes a mapping by id. */
export async function deleteMapping(id) {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    DELETE FROM github_forum_repository_mappings WHERE id = ${id}::uuid RETURNING id
  `;
  return Boolean(rows[0]);
}

/* ------------------------------------------------------------- issue links */

function mapIssueLink(row) {
  if (!row) return null;
  return {
    discordThreadId: row.discord_thread_id,
    discordStarterMessageId: row.discord_starter_message_id || null,
    discordGuildId: row.discord_guild_id || null,
    repository: row.github_repository,
    githubOwner: row.github_owner,
    githubRepo: row.github_repo,
    githubIssueNumber: row.github_issue_number,
    githubIssueId: row.github_issue_id ? String(row.github_issue_id) : null,
    githubIssueUrl: row.github_issue_url || null,
    issueState: row.issue_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The link for a Discord thread, or `null`. */
export async function getIssueLinkByThread(discordThreadId) {
  await ensureGithubForumSchema();
  const sql = db();
  const [row] = await sql`
    SELECT * FROM github_forum_issue_links WHERE discord_thread_id = ${String(discordThreadId)} LIMIT 1
  `;
  return mapIssueLink(row);
}

/** The link for a GitHub issue, or `null`. Used by the webhook consumer. */
export async function getIssueLinkByIssue({ repository, issueNumber }) {
  await ensureGithubForumSchema();
  const sql = db();
  const [row] = await sql`
    SELECT * FROM github_forum_issue_links
    WHERE github_repository = ${String(repository)} AND github_issue_number = ${Number(issueNumber)}
    LIMIT 1
  `;
  return mapIssueLink(row);
}

/**
 * Records the issue a Forum thread became.
 *
 * The thread id is the primary key and the repository+issue pair is unique, so a
 * retried create cannot link two threads to one issue or two issues to one
 * thread. `ON CONFLICT` makes the retry idempotent instead of an error.
 */
export async function insertIssueLink({
  discordThreadId,
  discordStarterMessageId = null,
  discordGuildId = null,
  repository,
  githubOwner,
  githubRepo,
  githubIssueNumber,
  githubIssueId = null,
  githubIssueUrl = null,
  issueState = ISSUE_STATE.OPEN,
} = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    INSERT INTO github_forum_issue_links (
      discord_thread_id, discord_starter_message_id, discord_guild_id,
      github_repository, github_owner, github_repo,
      github_issue_number, github_issue_id, github_issue_url, issue_state
    ) VALUES (
      ${discordThreadId}, ${discordStarterMessageId}, ${discordGuildId},
      ${repository}, ${githubOwner}, ${githubRepo},
      ${Number(githubIssueNumber)}, ${githubIssueId ? String(githubIssueId) : null}, ${githubIssueUrl}, ${issueState}
    )
    ON CONFLICT (discord_thread_id) DO UPDATE SET
      discord_starter_message_id = COALESCE(EXCLUDED.discord_starter_message_id, github_forum_issue_links.discord_starter_message_id),
      github_issue_id = COALESCE(EXCLUDED.github_issue_id, github_forum_issue_links.github_issue_id),
      github_issue_url = COALESCE(EXCLUDED.github_issue_url, github_forum_issue_links.github_issue_url),
      issue_state = EXCLUDED.issue_state,
      updated_at = now()
    RETURNING *
  `;
  return mapIssueLink(rows[0]);
}

/** Updates the tracked state of a linked issue. */
export async function updateIssueState({ repository, issueNumber, state }) {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    UPDATE github_forum_issue_links SET issue_state = ${state}, updated_at = now()
    WHERE github_repository = ${String(repository)} AND github_issue_number = ${Number(issueNumber)}
    RETURNING *
  `;
  return mapIssueLink(rows[0]);
}

/** A page of links for the dashboard. */
export async function listIssueLinks({ limit = 50, offset = 0, state = null } = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    SELECT * FROM github_forum_issue_links
    WHERE (${state}::text IS NULL OR issue_state = ${state})
    ORDER BY created_at DESC
    LIMIT ${Math.min(200, Math.max(1, Number(limit) || 50))}
    OFFSET ${Math.max(0, Number(offset) || 0)}
  `;
  return rows.map(mapIssueLink);
}

/* ----------------------------------------------------------- message links */

/**
 * Records that a Discord message and a GitHub comment are the same thing.
 *
 * Returns `{ created: false }` when either side is already linked, which is the
 * duplicate guard: a redelivered Discord event, a re-processed queue job or a
 * duplicate webhook all land here and change nothing. The direction is part of
 * the Discord-side key so the same message id cannot be double-linked.
 */
export async function recordMessageLink({
  discordMessageId,
  discordThreadId,
  repository,
  issueNumber,
  githubCommentId = null,
  direction,
} = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    INSERT INTO github_forum_message_links (
      discord_message_id, discord_thread_id, github_repository, github_issue_number, github_comment_id, direction
    ) VALUES (
      ${String(discordMessageId)}, ${String(discordThreadId)}, ${String(repository)}, ${Number(issueNumber)},
      ${githubCommentId ? String(githubCommentId) : null}, ${direction}
    )
    ON CONFLICT DO NOTHING
    RETURNING *
  `;
  if (rows[0]) return { created: true, link: mapMessageLink(rows[0]) };

  // A conflict means one side already exists; report which, so the caller can
  // tell "we already did this" from a genuine failure.
  const commentId = githubCommentId ? String(githubCommentId) : null;
  const [existing] = await sql`
    SELECT * FROM github_forum_message_links
    WHERE (discord_message_id = ${String(discordMessageId)} AND direction = ${direction})
       OR (${commentId}::bigint IS NOT NULL AND github_comment_id = ${commentId}::bigint)
    LIMIT 1
  `;
  return { created: false, link: mapMessageLink(existing) };
}

function mapMessageLink(row) {
  if (!row) return null;
  return {
    discordMessageId: row.discord_message_id,
    discordThreadId: row.discord_thread_id,
    repository: row.github_repository,
    issueNumber: row.github_issue_number,
    githubCommentId: row.github_comment_id ? String(row.github_comment_id) : null,
    direction: row.direction,
    createdAt: row.created_at,
  };
}

/** Whether a Discord message has already been turned into a comment. */
export async function isDiscordMessageLinked(discordMessageId, direction = 'discord_to_github') {
  await ensureGithubForumSchema();
  const sql = db();
  const [row] = await sql`
    SELECT 1 FROM github_forum_message_links
    WHERE discord_message_id = ${String(discordMessageId)} AND direction = ${direction}
    LIMIT 1
  `;
  return Boolean(row);
}

/** Whether a GitHub comment has already been published into Discord. */
export async function isGithubCommentLinked(githubCommentId) {
  if (!githubCommentId) return false;
  await ensureGithubForumSchema();
  const sql = db();
  const [row] = await sql`
    SELECT 1 FROM github_forum_message_links WHERE github_comment_id = ${String(githubCommentId)} LIMIT 1
  `;
  return Boolean(row);
}

/* -------------------------------------------------------------- the queue */

function mapJob(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    eventType: row.event_type,
    payload: row.payload || {},
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error || null,
    lockedAt: row.locked_at || null,
    dedupeKey: row.dedupe_key || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Enqueues a job.
 *
 * When `dedupeKey` is supplied, a second enqueue with the same key is a no-op —
 * that is what stops a redelivered webhook or a re-observed Discord event from
 * queueing twice. Returns `{ enqueued: false }` when the key already exists.
 */
export async function enqueueJob({ eventType, payload = {}, dedupeKey = null, runAt = null, maxAttempts = MAX_JOB_ATTEMPTS } = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    INSERT INTO github_forum_sync_queue (event_type, payload, dedupe_key, next_attempt_at, max_attempts)
    VALUES (${eventType}, ${sql.json(payload)}::jsonb, ${dedupeKey}, ${runAt || new Date()}, ${Number(maxAttempts)})
    ON CONFLICT DO NOTHING
    RETURNING *
  `;
  if (rows[0]) return { enqueued: true, job: mapJob(rows[0]) };
  return { enqueued: false, job: null };
}

/**
 * Claims a batch of ready jobs.
 *
 * The claim is one atomic statement: `FOR UPDATE SKIP LOCKED` picks only rows no
 * other worker holds, and the `UPDATE ... RETURNING` flips them to `processing`
 * in the same breath. Two bot processes (or two overlapping ticks in one) can
 * therefore run this concurrently without ever handling the same job — the
 * concurrency control lives in the database, not in a process-local flag.
 */
export async function claimJobs({ limit = 5, now = new Date() } = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    UPDATE github_forum_sync_queue SET
      status = ${JOB_STATUS.PROCESSING},
      locked_at = now(),
      updated_at = now()
    WHERE id IN (
      SELECT id FROM github_forum_sync_queue
      WHERE status = ${JOB_STATUS.PENDING} AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at ASC, id ASC
      LIMIT ${Math.max(1, Number(limit) || 5)}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows.map(mapJob);
}

/** Marks a job as done. */
export async function completeJob(id) {
  await ensureGithubForumSchema();
  const sql = db();
  await sql`
    UPDATE github_forum_sync_queue SET status = ${JOB_STATUS.SUCCEEDED}, locked_at = NULL, updated_at = now()
    WHERE id = ${String(id)}::bigint
  `;
}

/**
 * Records a failed attempt.
 *
 * The job returns to `pending` with a later `next_attempt_at` until its attempts
 * are exhausted, at which point it is parked as `dead`. A parked job is never
 * silently dropped: it stays visible in the dashboard with its last error and
 * can be retried by hand.
 */
export async function failJob(id, { error = '', maxAttempts = null } = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  const [row] = await sql`SELECT * FROM github_forum_sync_queue WHERE id = ${String(id)}::bigint LIMIT 1`;
  if (!row) return null;
  const attempts = Number(row.attempts) + 1;
  const limit = maxAttempts || row.max_attempts || MAX_JOB_ATTEMPTS;
  const exhausted = isJobExhausted(attempts, limit);
  const delay = nextRetryDelay(attempts);
  const nextAttemptAt = new Date(Date.now() + delay);

  const rows = await sql`
    UPDATE github_forum_sync_queue SET
      status = ${exhausted ? JOB_STATUS.DEAD : JOB_STATUS.PENDING},
      attempts = ${attempts},
      last_error = ${String(error || '').slice(0, 2000)},
      next_attempt_at = ${exhausted ? row.next_attempt_at : nextAttemptAt},
      locked_at = NULL,
      updated_at = now()
    WHERE id = ${String(id)}::bigint
    RETURNING *
  `;
  return mapJob(rows[0]);
}

/**
 * Returns a claimed job to the queue without counting an attempt.
 *
 * Used when the worker shuts down mid-job, so the job is retried rather than
 * left `processing` forever after a restart.
 */
export async function releaseJob(id) {
  await ensureGithubForumSchema();
  const sql = db();
  await sql`
    UPDATE github_forum_sync_queue SET status = ${JOB_STATUS.PENDING}, locked_at = NULL, updated_at = now()
    WHERE id = ${String(id)}::bigint AND status = ${JOB_STATUS.PROCESSING}
  `;
}

/**
 * Re-queues jobs stuck in `processing`.
 *
 * A process that died mid-job leaves rows claimed but never finished. Any such
 * row older than `staleMs` is returned to `pending`, so a restart recovers the
 * work instead of stranding it.
 */
export async function recoverStuckJobs({ staleMs = 10 * 60 * 1000 } = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  const cutoff = new Date(Date.now() - staleMs);
  const rows = await sql`
    UPDATE github_forum_sync_queue SET status = ${JOB_STATUS.PENDING}, locked_at = NULL, updated_at = now()
    WHERE status = ${JOB_STATUS.PROCESSING} AND (locked_at IS NULL OR locked_at < ${cutoff})
    RETURNING id
  `;
  return rows.length;
}

/** Re-queues a parked or failed job by hand. Resets its attempts. */
export async function retryJob(id) {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    UPDATE github_forum_sync_queue SET
      status = ${JOB_STATUS.PENDING}, attempts = 0, last_error = NULL, locked_at = NULL,
      next_attempt_at = now(), updated_at = now()
    WHERE id = ${String(id)}::bigint
    RETURNING *
  `;
  return mapJob(rows[0]);
}

/** A page of jobs, newest first, optionally filtered by status. */
export async function listJobs({ status = null, limit = 50, offset = 0 } = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    SELECT * FROM github_forum_sync_queue
    WHERE (${status}::text IS NULL OR status = ${status})
    ORDER BY created_at DESC
    LIMIT ${Math.min(200, Math.max(1, Number(limit) || 50))}
    OFFSET ${Math.max(0, Number(offset) || 0)}
  `;
  return rows.map(mapJob);
}

/** Counts by status, for the dashboard tiles. */
export async function jobCounts() {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`SELECT status, count(*)::int AS count FROM github_forum_sync_queue GROUP BY status`;
  const counts = { pending: 0, processing: 0, succeeded: 0, failed: 0, dead: 0 };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/* ----------------------------------------------------------------- logs */

/** Appends an activity log entry. */
export async function recordSyncLog({
  eventId = null,
  eventType,
  source = null,
  destination = null,
  repository = null,
  issueNumber = null,
  status,
  direction = null,
  attempts = 0,
  errorSummary = null,
  detail = null,
} = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  await sql`
    INSERT INTO github_forum_sync_logs (
      event_id, event_type, source, destination, repository, issue_number,
      status, direction, attempts, error_summary, detail
    ) VALUES (
      ${eventId}, ${eventType}, ${source}, ${destination}, ${repository}, ${issueNumber ? Number(issueNumber) : null},
      ${status}, ${direction}, ${Number(attempts) || 0}, ${errorSummary ? String(errorSummary).slice(0, 1000) : null},
      ${detail ? sql.json(detail) : null}
    )
  `;
}

/** A page of log entries, newest first. */
export async function listSyncLogs({ status = null, limit = 50, offset = 0 } = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    SELECT * FROM github_forum_sync_logs
    WHERE (${status}::text IS NULL OR status = ${status})
    ORDER BY created_at DESC
    LIMIT ${Math.min(200, Math.max(1, Number(limit) || 50))}
    OFFSET ${Math.max(0, Number(offset) || 0)}
  `;
  return rows.map((row) => ({
    id: String(row.id),
    eventId: row.event_id,
    eventType: row.event_type,
    source: row.source,
    destination: row.destination,
    repository: row.repository,
    issueNumber: row.issue_number,
    status: row.status,
    direction: row.direction,
    attempts: row.attempts,
    errorSummary: row.error_summary,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

/** The dashboard's overview figures. */
export async function getSyncStats() {
  await ensureGithubForumSchema();
  const sql = db();
  const [links] = await sql`SELECT count(*)::int AS count FROM github_forum_issue_links`;
  const [open] = await sql`SELECT count(*)::int AS count FROM github_forum_issue_links WHERE issue_state = 'open'`;
  const [messages] = await sql`SELECT count(*)::int AS count FROM github_forum_message_links`;
  const [success] = await sql`SELECT count(*)::int AS count FROM github_forum_sync_logs WHERE status = 'success'`;
  const [failed] = await sql`SELECT count(*)::int AS count FROM github_forum_sync_logs WHERE status = 'failure'`;
  const [last] = await sql`
    SELECT created_at FROM github_forum_sync_logs WHERE status = 'success' ORDER BY created_at DESC LIMIT 1
  `;
  const jobs = await jobCounts();
  return {
    linkedIssues: links?.count || 0,
    openIssues: open?.count || 0,
    syncedMessages: messages?.count || 0,
    successfulSyncs: success?.count || 0,
    failedSyncs: failed?.count || 0,
    lastSuccessAt: last?.created_at || null,
    jobs,
  };
}

/* ------------------------------------------------------ webhook deliveries */

/**
 * Records a webhook delivery.
 *
 * The GitHub delivery id is the primary key, so a redelivery of the same event
 * (GitHub retries on a non-2xx, and a delivery can be re-sent by hand) is
 * detected here before any work is done. Returns `{ duplicate: true }` when the
 * id is already present.
 */
export async function recordWebhookDelivery({ deliveryId, eventType = null, action = null } = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  const rows = await sql`
    INSERT INTO github_forum_webhook_deliveries (delivery_id, event_type, action, processing_status)
    VALUES (${String(deliveryId)}, ${eventType}, ${action}, 'received')
    ON CONFLICT (delivery_id) DO NOTHING
    RETURNING *
  `;
  if (rows[0]) return { duplicate: false, delivery: rows[0] };
  return { duplicate: true, delivery: null };
}

/** Marks a recorded delivery as processed. */
export async function markDeliveryProcessed(deliveryId, { status = 'processed', note = null } = {}) {
  await ensureGithubForumSchema();
  const sql = db();
  await sql`
    UPDATE github_forum_webhook_deliveries SET processing_status = ${status}, processed_at = now(), note = ${note}
    WHERE delivery_id = ${String(deliveryId)}
  `;
}

/* --------------------------------------------------------------- test only */

/** Test seams: a reset for the cached schema promise. */
export const __test = {
  resetSchema() {
    schemaReady = null;
  },
  closePool() {
    if (_sql) {
      const pool = _sql;
      _sql = null;
      return pool.end({ timeout: 5 }).catch(() => {});
    }
    return Promise.resolve();
  },
  JOB_TYPE,
};
