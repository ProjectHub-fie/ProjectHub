/**
 * The ProjectHub Mail data layer.
 *
 * All mail reads and writes funnel through here so the serverless function and
 * the Express dev server behave identically, and so the "keep database usage
 * low" rules live in one place:
 *
 *   - Lists are always paginated and never select full bodies.
 *   - Counts use a single aggregate query instead of counting rows in JS.
 *   - Related threads are fetched for the current page only, in one query.
 *   - Ingestion is idempotent on the provider message id, so a retried webhook
 *     cannot duplicate a message.
 *   - Notifications are written per active admin in one statement, and only a
 *     short preview is stored — never a body.
 *
 * `postgres` (not drizzle) is used directly here for the same reason the admin
 * function uses it: the tables are created lazily on first use, which keeps a
 * fresh database working without a separate migration step.
 */
import postgres from 'postgres';
import { normalizeDatabaseUrl } from './db-url.js';
import { sanitizeEmailHtml, toSnippet } from './mail-sanitize.js';

let _sql = null;
function db() {
  _sql ||= postgres(normalizeDatabaseUrl(mailDatabaseUrl()), { ssl: 'require', max: 5 });
  return _sql;
}

/**
 * The connection string the mailbox lives on.
 *
 * `MAIL_DATABASE_URL` lets the mailbox live in its own database so its write
 * volume (inbound mail, notifications, audit rows) cannot compete with the
 * application's. It falls back to `DATABASE_URL`, which keeps a single-database
 * deployment working with no extra configuration.
 */
export function mailDatabaseUrl() {
  return process.env.MAIL_DATABASE_URL || process.env.DATABASE_URL;
}

/**
 * Whether the mailbox is on a different database from the application.
 *
 * This matters because the mail tables reference `admin_credentials` by foreign
 * key, and a foreign key cannot span databases. On a split deployment the
 * reference has to become a plain uuid and admin cleanup has to be explicit.
 */
export function isMailDatabaseSeparate() {
  const mail = process.env.MAIL_DATABASE_URL;
  if (!mail) return false;
  return mail !== process.env.DATABASE_URL;
}

/**
 * A connection to the application database, used only to resolve application-side
 * data the mailbox needs but cannot join to: the admin recipient list, admin
 * pins, and the source rows the backfill mirrors.
 *
 * When the mailbox shares the application database this returns that same pool
 * so no second connection is opened.
 */
let _mainSql = null;
function mainDb() {
  if (!isMailDatabaseSeparate()) return db();
  _mainSql ||= postgres(normalizeDatabaseUrl(process.env.DATABASE_URL), { ssl: 'require', max: 3 });
  return _mainSql;
}

let schemaReady = null;

/**
 * Creates the mail tables if they are missing.
 *
 * Mirrors the `ensureAdminSchema` convention already used by the dashboard: the
 * DDL is idempotent and cached per instance, so it runs at most once per cold
 * start and a fresh database works without an operator step.
 */
export function ensureMailSchema() {
  schemaReady ||= (async () => {
    const sql = db();
    // A foreign key cannot cross databases. When the mailbox is on its own
    // database, `admin_credentials` lives elsewhere and cannot be referenced, so
    // the column becomes a plain uuid and admin ids are validated against the
    // application database at the call sites instead.
    const adminRef = (onDelete) =>
      isMailDatabaseSeparate()
        ? sql.unsafe('')
        : sql.unsafe(` REFERENCES admin_credentials(id) ON DELETE ${onDelete}`);
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS mail_threads (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          root_message_id text,
          subject text,
          participants text[],
          last_message_at timestamp DEFAULT now() NOT NULL,
          message_count integer DEFAULT 1 NOT NULL,
          unread_count integer DEFAULT 0 NOT NULL,
          is_starred boolean DEFAULT false NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mail_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          thread_id uuid NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
          provider_message_id text,
          direction text DEFAULT 'inbound' NOT NULL,
          status text DEFAULT 'received' NOT NULL,
          from_name text,
          from_email text,
          to_emails text[],
          cc_emails text[],
          bcc_emails text[],
          reply_to text,
          subject text,
          body_html text,
          body_text text,
          snippet text,
          has_attachments boolean DEFAULT false NOT NULL,
          is_read boolean DEFAULT false NOT NULL,
          is_starred boolean DEFAULT false NOT NULL,
          is_trashed boolean DEFAULT false NOT NULL,
          provider text,
          in_reply_to text,
          -- The RFC name for this column is a reserved word in Postgres, so the
          -- column is message_references; the JS field keeps the header name.
          message_references text[],
          source_type text,
          source_id text,
          sent_at timestamp,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mail_attachments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          message_id uuid NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
          filename text NOT NULL,
          content_type text,
          size_bytes integer,
          provider_attachment_id text,
          content_data text,
          created_at timestamp DEFAULT now() NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mail_drafts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          admin_id uuid NOT NULL ${adminRef('CASCADE')},
          thread_id uuid REFERENCES mail_threads(id) ON DELETE SET NULL,
          template_id uuid,
          mode text DEFAULT 'new' NOT NULL,
          to_emails text[],
          cc_emails text[],
          bcc_emails text[],
          subject text,
          body_html text,
          attachments_meta jsonb,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mail_templates (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          name text NOT NULL,
          category text DEFAULT 'general' NOT NULL,
          subject text,
          body_html text,
          body_text text,
          created_by uuid ${adminRef('SET NULL')},
          is_archived boolean DEFAULT false NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mail_signatures (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          admin_id uuid NOT NULL UNIQUE ${adminRef('CASCADE')},
          name text,
          position text,
          company text,
          website text,
          social_links jsonb,
          logo_url text,
          enabled boolean DEFAULT true NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mail_notifications (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          admin_id uuid NOT NULL ${adminRef('CASCADE')},
          type text DEFAULT 'new_email' NOT NULL,
          message_id uuid REFERENCES mail_messages(id) ON DELETE CASCADE,
          thread_id uuid REFERENCES mail_threads(id) ON DELETE CASCADE,
          title text,
          body_preview text,
          is_read boolean DEFAULT false NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          admin_id uuid NOT NULL ${adminRef('CASCADE')},
          endpoint text NOT NULL UNIQUE,
          p256dh text NOT NULL,
          auth text NOT NULL,
          user_agent text,
          created_at timestamp DEFAULT now() NOT NULL,
          last_seen_at timestamp DEFAULT now() NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mail_notification_settings (
          admin_id uuid PRIMARY KEY ${adminRef('CASCADE')},
          notify_new_email boolean DEFAULT true NOT NULL,
          notify_project_request boolean DEFAULT true NOT NULL,
          notify_reply boolean DEFAULT true NOT NULL,
          notify_important boolean DEFAULT true NOT NULL,
          desktop_enabled boolean DEFAULT false NOT NULL,
          sound_enabled boolean DEFAULT false NOT NULL,
          badge_enabled boolean DEFAULT true NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mail_audit_log (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          admin_id uuid ${adminRef('SET NULL')},
          action text NOT NULL,
          target_type text,
          target_id text,
          details jsonb,
          created_at timestamp DEFAULT now() NOT NULL
        )
      `;
      // Indexes the mailbox queries rely on. IF NOT EXISTS keeps this re-runnable.
      await sql`CREATE INDEX IF NOT EXISTS mail_threads_last_message_idx ON mail_threads (last_message_at)`;
      await sql`CREATE INDEX IF NOT EXISTS mail_threads_root_message_idx ON mail_threads (root_message_id)`;
      await sql`CREATE INDEX IF NOT EXISTS mail_messages_thread_idx ON mail_messages (thread_id, created_at)`;
      await sql`CREATE INDEX IF NOT EXISTS mail_messages_source_idx ON mail_messages (source_type, source_id)`;
      await sql`CREATE INDEX IF NOT EXISTS mail_messages_status_idx ON mail_messages (status, direction)`;
      await sql`CREATE INDEX IF NOT EXISTS mail_messages_trash_idx ON mail_messages (is_trashed, direction, created_at)`;
      await sql`CREATE INDEX IF NOT EXISTS mail_attachments_message_idx ON mail_attachments (message_id)`;
      await sql`CREATE INDEX IF NOT EXISTS mail_drafts_admin_idx ON mail_drafts (admin_id, updated_at)`;
      await sql`CREATE INDEX IF NOT EXISTS mail_templates_category_idx ON mail_templates (category, is_archived)`;
      await sql`CREATE INDEX IF NOT EXISTS mail_notifications_admin_unread_idx ON mail_notifications (admin_id, is_read, created_at)`;
      await sql`CREATE INDEX IF NOT EXISTS push_subscriptions_admin_idx ON push_subscriptions (admin_id)`;
      await sql`CREATE INDEX IF NOT EXISTS mail_audit_log_created_idx ON mail_audit_log (created_at)`;
      // Partial unique index: a provider retry must not create a second row for
      // the same message, but multiple NULL provider ids are fine (drafts etc).
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_provider_message_idx
        ON mail_messages (provider_message_id)
        WHERE provider_message_id IS NOT NULL
      `;
    } catch (error) {
      schemaReady = null;
      throw error;
    }
  })();
  return schemaReady;
}

/** Lowercases an address list for storage and comparison. */
function normalizeAddresses(list) {
  if (!list) return [];
  const values = Array.isArray(list) ? list : String(list).split(',');
  return values
    .map((value) => (typeof value === 'string' ? value : value?.email) || '')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/** Replaces `user@host` inside a Message-ID header with a stable key. */
function normalizeMessageId(value) {
  if (!value) return null;
  return String(value).trim().replace(/^<|>$/g, '') || null;
}

/** Normalises a subject for thread matching ("Re:"/"Fwd:" are not identity). */
export function normalizeSubject(subject) {
  if (!subject) return '';
  let out = String(subject).trim();
  // Strip any number of reply/forward prefixes, including localised-looking ones.
  let previous;
  do {
    previous = out;
    out = out.replace(/^\s*(re|fwd?|fw|aw|sv|antw)\s*(\[\d+\])?\s*:\s*/i, '');
  } while (out !== previous);
  return out.trim().toLowerCase();
}

/**
 * Finds the thread an incoming message belongs to.
 *
 * Order matters: explicit headers are authoritative, then the root message id,
 * then a subject + participant match for the case where a provider strips the
 * threading headers.
 */
async function resolveThreadId({ inReplyTo, references, subject, participants }) {
  const sql = db();
  const candidates = [
    ...(Array.isArray(references) ? references : []),
    inReplyTo,
  ]
    .map(normalizeMessageId)
    .filter(Boolean);

  for (const candidate of candidates) {
    const rows = await sql`
      SELECT t.id
      FROM mail_threads t
      WHERE t.root_message_id = ${candidate}
         OR EXISTS (
           SELECT 1 FROM mail_messages m
           WHERE m.thread_id = t.id
             AND (m.provider_message_id = ${candidate} OR ${candidate} = ANY(COALESCE(m.message_references, '{}')))
         )
      LIMIT 1
    `;
    if (rows[0]) return rows[0].id;
  }

  const key = normalizeSubject(subject);
  if (!key || !participants.length) return null;

  // Subject fallback is scoped to a participant of this thread so two unrelated
  // "Invoice" threads do not merge.
  const rows = await sql`
    SELECT t.id
    FROM mail_threads t
    WHERE lower(regexp_replace(COALESCE(t.subject, ''), '^\\s*(re|fwd?|fw|aw|sv|antw)\\s*(\\[\\d+\\])?\\s*:\\s*', '', 'i')) = ${key}
      AND COALESCE(t.participants, '{}') && ${participants}
    ORDER BY t.last_message_at DESC
    LIMIT 1
  `;
  return rows[0]?.id || null;
}

/**
 * Inserts an inbound or outbound message, creating or extending its thread.
 *
 * Idempotent: when `providerMessageId` already exists the existing row is
 * returned untouched, so a webhook retry never duplicates the inbox entry.
 */
export async function ingestMessage({
  providerMessageId = null,
  threadId: requestedThreadId = null,
  direction = 'inbound',
  status = 'received',
  fromName = null,
  fromEmail = null,
  to = [],
  cc = [],
  bcc = [],
  replyTo = null,
  subject = null,
  bodyHtml = null,
  bodyText = null,
  hasAttachments = false,
  provider = null,
  inReplyTo = null,
  references = [],
  sourceType = null,
  sourceId = null,
  sentAt = null,
  isRead = false,
  attachments = [],
}) {
  await ensureMailSchema();
  const sql = db();

  const providerId = normalizeMessageId(providerMessageId);
  if (providerId) {
    const existing = await sql`
      SELECT id, thread_id FROM mail_messages WHERE provider_message_id = ${providerId} LIMIT 1
    `;
    if (existing[0]) {
      return { id: existing[0].id, threadId: existing[0].thread_id, duplicate: true };
    }
  }

  const toEmails = normalizeAddresses(to);
  const ccEmails = normalizeAddresses(cc);
  const bccEmails = normalizeAddresses(bcc);
  const from = fromEmail ? String(fromEmail).trim().toLowerCase() : null;

  const participants = [...new Set([from, ...toEmails, ...ccEmails, ...bccEmails].filter(Boolean))];

  const snippet = toSnippet(bodyText || bodyHtml || '');

  // Look up the thread first so the fallback match can run before we insert. An
  // explicit thread id (a reply, say) wins over header-based matching.
  let threadId = requestedThreadId || (await resolveThreadId({
    inReplyTo,
    references,
    subject,
    participants,
  }));

  const rootMessageId = providerId || null;

  if (threadId && requestedThreadId) {
    // The caller already knows the conversation, so attach to it rather than
    // re-deriving it from headers.
    await sql`
      UPDATE mail_threads
      SET last_message_at = now(),
          message_count = message_count + 1,
          unread_count = unread_count + ${isRead ? 0 : 1},
          subject = COALESCE(subject, ${subject}),
          updated_at = now()
      WHERE id = ${threadId}::uuid
    `;
  } else if (!threadId) {
    const inserted = await sql`
      INSERT INTO mail_threads (root_message_id, subject, participants, last_message_at, message_count, unread_count)
      VALUES (${rootMessageId}, ${subject}, ${participants}, now(), 1, ${isRead ? 0 : 1})
      RETURNING id
    `;
    threadId = inserted[0].id;
  } else {
    await sql`
      UPDATE mail_threads
      SET last_message_at = now(),
          message_count = message_count + 1,
          unread_count = unread_count + ${isRead ? 0 : 1},
          subject = COALESCE(subject, ${subject}),
          participants = (
            SELECT array_agg(DISTINCT p)
            FROM unnest(COALESCE(participants, '{}') || ${participants}::text[]) AS p
          ),
          updated_at = now()
      WHERE id = ${threadId}::uuid
    `;
  }

  const rows = await sql`
    INSERT INTO mail_messages (
      thread_id, provider_message_id, direction, status, from_name, from_email,
      to_emails, cc_emails, bcc_emails, reply_to, subject, body_html, body_text,
      snippet, has_attachments, provider, in_reply_to, message_references, source_type,
      source_id, sent_at, is_read
    ) VALUES (
      ${threadId}::uuid, ${providerId}, ${direction}, ${status}, ${fromName}, ${from},
      ${toEmails}, ${ccEmails}, ${bccEmails}, ${replyTo}, ${subject}, ${bodyHtml}, ${bodyText},
      ${snippet}, ${hasAttachments || attachments.length > 0}, ${provider}, ${normalizeMessageId(inReplyTo)},
      ${(Array.isArray(references) ? references : []).map(normalizeMessageId).filter(Boolean)},
      ${sourceType}, ${sourceId}, ${sentAt}, ${isRead}
    )
    RETURNING id
  `;

  const messageId = rows[0].id;

  for (const file of attachments) {
    await sql`
      INSERT INTO mail_attachments (message_id, filename, content_type, size_bytes, provider_attachment_id, content_data)
      VALUES (
        ${messageId}::uuid, ${file.filename}, ${file.contentType || null},
        ${file.sizeBytes ?? null}, ${file.providerAttachmentId || null}, ${file.contentData || null}
      )
    `;
  }

  return { id: messageId, threadId, duplicate: false };
}

/** Column list for list queries — deliberately excludes body columns. */
const LIST_COLUMNS = `m.id, m.thread_id, m.direction, m.status, m.from_name, m.from_email,
  m.to_emails, m.subject, m.snippet, m.has_attachments, m.is_read, m.is_starred,
  m.is_trashed, m.provider, m.created_at, m.sent_at,
  t.participants, t.message_count, t.is_starred AS thread_starred, t.last_message_at`;

/**
 * Lists messages for a mailbox view.
 *
 * `view` selects the base predicate; `filters` narrow it further. Every value is
 * interpolated through the driver's tagged template, so the search term in
 * particular is always a bound parameter and never becomes SQL.
 */
export async function listMessages({ view = 'inbox', filters = {}, page = 1, pageSize = 25 }) {
  await ensureMailSchema();
  const sql = db();

  const limit = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const conditions = [];

  if (view === 'trash') {
    conditions.push(sql`m.is_trashed = true`);
  } else {
    conditions.push(sql`m.is_trashed = false`);
    if (view === 'inbox') conditions.push(sql`m.direction = 'inbound'`);
    if (view === 'sent') conditions.push(sql`m.direction = 'outbound' AND m.status <> 'draft'`);
    if (view === 'starred') conditions.push(sql`(m.is_starred = true OR t.is_starred = true)`);
    if (view === 'drafts') conditions.push(sql`m.status = 'draft'`);
  }

  if (filters.inbox === true && view !== 'inbox') conditions.push(sql`m.direction = 'inbound'`);
  if (filters.unread === true) conditions.push(sql`m.is_read = false`);
  if (filters.attachments === true) conditions.push(sql`m.has_attachments = true`);
  if (filters.starred === true) conditions.push(sql`(m.is_starred = true OR t.is_starred = true)`);
  if (filters.from) conditions.push(sql`m.from_email = ${String(filters.from).toLowerCase()}`);
  if (filters.after) conditions.push(sql`m.created_at >= ${filters.after}`);
  if (filters.before) conditions.push(sql`m.created_at <= ${filters.before}`);

  if (filters.search) {
    // ILIKE keeps the search server-side; the caller never downloads the mailbox.
    const term = `%${String(filters.search).trim()}%`;
    conditions.push(sql`(
      m.subject ILIKE ${term}
      OR m.from_email ILIKE ${term}
      OR m.from_name ILIKE ${term}
      OR m.snippet ILIKE ${term}
      OR array_to_string(COALESCE(m.to_emails, '{}'), ' ') ILIKE ${term}
    )`);
  }

  // Compose the predicates as bound fragments so nothing is string-concatenated.
  let where = null;
  conditions.forEach((condition, index) => {
    where = index === 0 ? sql`WHERE ${condition}` : sql`${where} AND ${condition}`;
  });

  const rows = await sql`
    SELECT ${sql.unsafe(LIST_COLUMNS)}
    FROM mail_messages m
    JOIN mail_threads t ON t.id = m.thread_id
    ${where}
    ORDER BY COALESCE(m.sent_at, m.created_at) DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return { rows: rows.map(mapListRow), page: Math.max(Number(page) || 1, 1), pageSize: limit };
}

function mapListRow(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    direction: row.direction,
    status: row.status,
    fromName: row.from_name,
    fromEmail: row.from_email,
    toEmails: row.to_emails || [],
    subject: row.subject,
    snippet: row.snippet,
    hasAttachments: row.has_attachments,
    isRead: row.is_read,
    isStarred: row.is_starred || row.thread_starred,
    isTrashed: row.is_trashed,
    provider: row.provider,
    messageCount: row.message_count,
    participants: row.participants || [],
    date: row.sent_at || row.created_at,
    lastMessageAt: row.last_message_at,
  };
}

/**
 * Unread and total counts for the sidebar.
 *
 * One aggregate over the already-indexed predicates rather than several round
 * trips, and it never reads message bodies.
 */
export async function getMailCounts() {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE m.direction = 'inbound' AND m.is_trashed = false AND m.is_read = false)::int AS inbox_unread,
      COUNT(*) FILTER (WHERE m.direction = 'inbound' AND m.is_trashed = false)::int AS inbox_total,
      COUNT(*) FILTER (WHERE m.status = 'draft')::int AS drafts,
      COUNT(*) FILTER (WHERE (m.is_starred = true OR t.is_starred = true) AND m.is_trashed = false)::int AS starred,
      COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.status <> 'draft' AND m.is_trashed = false)::int AS sent,
      COUNT(*) FILTER (WHERE m.is_trashed = true)::int AS trash
    FROM mail_messages m
    JOIN mail_threads t ON t.id = m.thread_id
  `;
  const row = rows[0] || {};
  return {
    inbox: row.inbox_unread || 0,
    inboxTotal: row.inbox_total || 0,
    drafts: row.drafts || 0,
    starred: row.starred || 0,
    sent: row.sent || 0,
    trash: row.trash || 0,
  };
}

/** A single message with sanitized bodies and its attachments. */
export async function getMessage(id) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    SELECT m.*, t.message_count, t.participants, t.root_message_id,
           t.is_starred AS thread_starred
    FROM mail_messages m
    JOIN mail_threads t ON t.id = m.thread_id
    WHERE m.id = ${id}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  const attachments = await sql`
    SELECT id, filename, content_type, size_bytes, provider_attachment_id,
           (content_data IS NOT NULL) AS has_content
    FROM mail_attachments WHERE message_id = ${id}::uuid
  `;

  return {
    id: row.id,
    threadId: row.thread_id,
    direction: row.direction,
    status: row.status,
    fromName: row.from_name,
    fromEmail: row.from_email,
    toEmails: row.to_emails || [],
    ccEmails: row.cc_emails || [],
    bccEmails: row.bcc_emails || [],
    replyTo: row.reply_to,
    subject: row.subject,
    // Sanitised on read: the database never holds trusted HTML.
    html: row.body_html ? sanitizeEmailHtml(row.body_html) : null,
    text: row.body_text || null,
    snippet: row.snippet,
    hasAttachments: row.has_attachments,
    isRead: row.is_read,
    // A starred conversation is starred everywhere: the list already ORs the
    // thread flag, so a single message read must agree with it.
    isStarred: row.is_starred || Boolean(row.thread_starred),
    isTrashed: row.is_trashed,
    provider: row.provider,
    inReplyTo: row.in_reply_to,
    references: row.message_references || [],
    sourceType: row.source_type,
    sourceId: row.source_id,
    date: row.sent_at || row.created_at,
    attachments: attachments.map((file) => ({
      id: file.id,
      filename: file.filename,
      contentType: file.content_type,
      sizeBytes: file.size_bytes,
      available: Boolean(file.has_content || file.provider_attachment_id),
    })),
  };
}

/** All messages in a thread, oldest first, with sanitized bodies. */
export async function getThreadMessages(threadId) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    SELECT m.*, t.subject AS thread_subject, t.participants, t.is_starred AS thread_starred
    FROM mail_messages m
    JOIN mail_threads t ON t.id = m.thread_id
    WHERE m.thread_id = ${threadId}::uuid AND m.is_trashed = false
    ORDER BY COALESCE(m.sent_at, m.created_at) ASC
  `;
  const threadRows = await sql`
    SELECT id, subject, participants, is_starred, message_count FROM mail_threads WHERE id = ${threadId}::uuid LIMIT 1
  `;
  const thread = threadRows[0];

  const attachmentRows = rows.length
    ? await sql`
        SELECT id, message_id, filename, content_type, size_bytes, provider_attachment_id,
               (content_data IS NOT NULL) AS has_content
        FROM mail_attachments WHERE message_id = ANY(${rows.map((r) => r.id)}::uuid[])
      `
    : [];
  const byMessage = new Map();
  for (const file of attachmentRows) {
    const list = byMessage.get(file.message_id) || [];
    list.push({
      id: file.id,
      filename: file.filename,
      contentType: file.content_type,
      sizeBytes: file.size_bytes,
      available: Boolean(file.has_content || file.provider_attachment_id),
    });
    byMessage.set(file.message_id, list);
  }

  return {
    thread: thread
      ? {
          id: thread.id,
          subject: thread.subject,
          participants: thread.participants || [],
          isStarred: thread.is_starred,
          messageCount: thread.message_count,
        }
      : null,
    messages: rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      status: row.status,
      fromName: row.from_name,
      fromEmail: row.from_email,
      toEmails: row.to_emails || [],
      ccEmails: row.cc_emails || [],
      subject: row.subject,
      html: row.body_html ? sanitizeEmailHtml(row.body_html) : null,
      text: row.body_text || null,
      snippet: row.snippet,
      provider: row.provider,
      isRead: row.is_read,
      isStarred: row.is_starred,
      date: row.sent_at || row.created_at,
      attachments: byMessage.get(row.id) || [],
    })),
  };
}

/** Loads one attachment, including its content only when explicitly requested. */
export async function getAttachment(id, { withContent = false } = {}) {
  await ensureMailSchema();
  const sql = db();
  const rows = withContent
    ? await sql`SELECT * FROM mail_attachments WHERE id = ${id}::uuid LIMIT 1`
    : await sql`
        SELECT id, filename, content_type, size_bytes, provider_attachment_id
        FROM mail_attachments WHERE id = ${id}::uuid LIMIT 1
      `;
  return rows[0] || null;
}

/** Marks a message read/unread and keeps the thread counter in step. */
export async function setMessageRead(id, isRead) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    UPDATE mail_messages SET is_read = ${isRead}, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, thread_id, is_read
  `;
  if (!rows[0]) return null;
  // Recomputed from the messages rather than decremented, so a repeated call
  // cannot drift the counter.
  await syncThreadUnread(rows[0].thread_id);
  return { id: rows[0].id, isRead: rows[0].is_read };
}

async function syncThreadUnread(threadId) {
  const sql = db();
  await sql`
    UPDATE mail_threads
    SET unread_count = (
      SELECT COUNT(*) FROM mail_messages
      WHERE thread_id = ${threadId}::uuid AND is_read = false AND is_trashed = false
    ), updated_at = now()
    WHERE id = ${threadId}::uuid
  `;
}

/** Stars/unstars a message or, when `thread` is set, the whole conversation. */
export async function setMessageStar(id, isStarred, { thread = false } = {}) {
  await ensureMailSchema();
  const sql = db();
  if (thread) {
    const rows = await sql`
      UPDATE mail_threads SET is_starred = ${isStarred}, updated_at = now()
      WHERE id = (
        SELECT thread_id FROM mail_messages WHERE id = ${id}::uuid
      )
      RETURNING id
    `;
    if (!rows[0]) return null;
    return { threadId: rows[0].id, isStarred };
  }
  const rows = await sql`
    UPDATE mail_messages SET is_starred = ${isStarred}, updated_at = now()
    WHERE id = ${id}::uuid RETURNING id, is_starred
  `;
  if (!rows[0]) return null;
  return { id: rows[0].id, isStarred: rows[0].is_starred };
}

/** Moves a message to or out of the trash. */
export async function setMessageTrashed(id, isTrashed) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    UPDATE mail_messages SET is_trashed = ${isTrashed}, updated_at = now()
    WHERE id = ${id}::uuid RETURNING id, thread_id
  `;
  if (!rows[0]) return null;
  await syncThreadUnread(rows[0].thread_id);
  return { id: rows[0].id, isTrashed };
}

/** Marks every message in a thread read. */
export async function markThreadRead(threadId, isRead = true) {
  await ensureMailSchema();
  const sql = db();
  await sql`
    UPDATE mail_messages SET is_read = ${isRead}, updated_at = now()
    WHERE thread_id = ${threadId}::uuid
  `;
  await syncThreadUnread(threadId);
}

/** Bulk action over explicit ids — never "all rows matching a filter". */
export async function bulkUpdate(ids, action) {
  await ensureMailSchema();
  const sql = db();
  if (!ids.length) return { updated: 0 };

  if (action === 'read' || action === 'unread') {
    const rows = await sql`
      UPDATE mail_messages SET is_read = ${action === 'read'}, updated_at = now()
      WHERE id = ANY(${ids}::uuid[]) RETURNING thread_id
    `;
    for (const threadId of new Set(rows.map((r) => r.thread_id))) await syncThreadUnread(threadId);
    return { updated: rows.length };
  }
  if (action === 'trash') {
    const rows = await sql`
      UPDATE mail_messages SET is_trashed = true, updated_at = now()
      WHERE id = ANY(${ids}::uuid[]) RETURNING thread_id
    `;
    for (const threadId of new Set(rows.map((r) => r.thread_id))) await syncThreadUnread(threadId);
    return { updated: rows.length };
  }
  if (action === 'restore') {
    const rows = await sql`
      UPDATE mail_messages SET is_trashed = false, updated_at = now()
      WHERE id = ANY(${ids}::uuid[]) RETURNING thread_id
    `;
    for (const threadId of new Set(rows.map((r) => r.thread_id))) await syncThreadUnread(threadId);
    return { updated: rows.length };
  }
  if (action === 'star' || action === 'unstar') {
    const rows = await sql`
      UPDATE mail_messages SET is_starred = ${action === 'star'}, updated_at = now()
      WHERE id = ANY(${ids}::uuid[]) RETURNING id
    `;
    return { updated: rows.length };
  }
  return { updated: 0 };
}

/* ------------------------------------------------------------------ drafts */

export async function listDrafts(adminId) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    SELECT id, thread_id, template_id, mode, to_emails, cc_emails, bcc_emails,
           subject, body_html, attachments_meta, created_at, updated_at
    FROM mail_drafts WHERE admin_id = ${adminId}::uuid
    ORDER BY updated_at DESC LIMIT 100
  `;
  return rows.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    templateId: row.template_id,
    mode: row.mode,
    to: row.to_emails || [],
    cc: row.cc_emails || [],
    bcc: row.bcc_emails || [],
    subject: row.subject,
    bodyHtml: row.body_html,
    attachments: row.attachments_meta || [],
    updatedAt: row.updated_at,
  }));
}

export async function getDraft(id, adminId) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    SELECT * FROM mail_drafts WHERE id = ${id}::uuid AND admin_id = ${adminId}::uuid LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    threadId: row.thread_id,
    templateId: row.template_id,
    mode: row.mode,
    to: row.to_emails || [],
    cc: row.cc_emails || [],
    bcc: row.bcc_emails || [],
    subject: row.subject,
    bodyHtml: row.body_html,
    attachments: row.attachments_meta || [],
    updatedAt: row.updated_at,
  };
}

export async function saveDraft({ id = null, adminId, threadId = null, templateId = null, mode = 'new', to = [], cc = [], bcc = [], subject = '', bodyHtml = '', attachments = [] }) {
  await ensureMailSchema();
  const sql = db();
  const values = {
    adminId,
    threadId,
    templateId,
    mode,
    to: normalizeAddresses(to),
    cc: normalizeAddresses(cc),
    bcc: normalizeAddresses(bcc),
    subject,
    bodyHtml,
    attachments: sql.json(attachments),
  };

  if (id) {
    const rows = await sql`
      UPDATE mail_drafts SET
        thread_id = ${values.threadId}, template_id = ${values.templateId}, mode = ${values.mode},
        to_emails = ${values.to}, cc_emails = ${values.cc}, bcc_emails = ${values.bcc},
        subject = ${values.subject}, body_html = ${values.bodyHtml},
        attachments_meta = ${values.attachments}, updated_at = now()
      WHERE id = ${id}::uuid AND admin_id = ${adminId}::uuid
      RETURNING id, updated_at
    `;
    if (rows[0]) return { id: rows[0].id, updatedAt: rows[0].updated_at, created: false };
  }

  const rows = await sql`
    INSERT INTO mail_drafts (admin_id, thread_id, template_id, mode, to_emails, cc_emails, bcc_emails, subject, body_html, attachments_meta)
    VALUES (${values.adminId}::uuid, ${values.threadId}, ${values.templateId}, ${values.mode},
            ${values.to}, ${values.cc}, ${values.bcc}, ${values.subject}, ${values.bodyHtml}, ${values.attachments})
    RETURNING id, updated_at
  `;
  return { id: rows[0].id, updatedAt: rows[0].updated_at, created: true };
}

export async function deleteDraft(id, adminId) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    DELETE FROM mail_drafts WHERE id = ${id}::uuid AND admin_id = ${adminId}::uuid RETURNING id
  `;
  return Boolean(rows[0]);
}

/* --------------------------------------------------------------- templates */

export async function listTemplates({ includeArchived = false } = {}) {
  await ensureMailSchema();
  const sql = db();
  const rows = includeArchived
    ? await sql`SELECT * FROM mail_templates ORDER BY category, name`
    : await sql`SELECT * FROM mail_templates WHERE is_archived = false ORDER BY category, name`;
  return rows.map(mapTemplate);
}

function mapTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    isArchived: row.is_archived,
    updatedAt: row.updated_at,
  };
}

export async function getTemplate(id) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`SELECT * FROM mail_templates WHERE id = ${id}::uuid LIMIT 1`;
  return rows[0] ? mapTemplate(rows[0]) : null;
}

export async function createTemplate({ name, category = 'general', subject = '', bodyHtml = '', bodyText = '', createdBy = null }) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    INSERT INTO mail_templates (name, category, subject, body_html, body_text, created_by)
    VALUES (${name}, ${category}, ${subject}, ${bodyHtml}, ${bodyText}, ${createdBy})
    RETURNING *
  `;
  return mapTemplate(rows[0]);
}

export async function updateTemplate(id, fields) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    UPDATE mail_templates SET
      name = COALESCE(${fields.name ?? null}, name),
      category = COALESCE(${fields.category ?? null}, category),
      subject = COALESCE(${fields.subject ?? null}, subject),
      body_html = COALESCE(${fields.bodyHtml ?? null}, body_html),
      body_text = COALESCE(${fields.bodyText ?? null}, body_text),
      is_archived = COALESCE(${fields.isArchived ?? null}, is_archived),
      updated_at = now()
    WHERE id = ${id}::uuid RETURNING *
  `;
  return rows[0] ? mapTemplate(rows[0]) : null;
}

export async function deleteTemplate(id) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`DELETE FROM mail_templates WHERE id = ${id}::uuid RETURNING id`;
  return Boolean(rows[0]);
}

export async function duplicateTemplate(id, createdBy) {
  const original = await getTemplate(id);
  if (!original) return null;
  return createTemplate({
    name: `${original.name} (copy)`,
    category: original.category,
    subject: original.subject,
    bodyHtml: original.bodyHtml,
    bodyText: original.bodyText,
    createdBy,
  });
}

/* -------------------------------------------------------------- signatures */

export async function getSignature(adminId) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`SELECT * FROM mail_signatures WHERE admin_id = ${adminId}::uuid LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  return {
    name: row.name,
    position: row.position,
    company: row.company,
    website: row.website,
    socialLinks: row.social_links || {},
    logoUrl: row.logo_url,
    enabled: row.enabled,
  };
}

export async function saveSignature(adminId, fields) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    INSERT INTO mail_signatures (admin_id, name, position, company, website, social_links, logo_url, enabled)
    VALUES (
      ${adminId}::uuid, ${fields.name ?? null}, ${fields.position ?? null}, ${fields.company ?? null},
      ${fields.website ?? null}, ${sql.json(fields.socialLinks || {})}, ${fields.logoUrl ?? null},
      ${fields.enabled !== false}
    )
    ON CONFLICT (admin_id) DO UPDATE SET
      name = EXCLUDED.name,
      position = EXCLUDED.position,
      company = EXCLUDED.company,
      website = EXCLUDED.website,
      social_links = EXCLUDED.social_links,
      logo_url = EXCLUDED.logo_url,
      enabled = EXCLUDED.enabled,
      updated_at = now()
    RETURNING *
  `;
  const row = rows[0];
  return {
    name: row.name,
    position: row.position,
    company: row.company,
    website: row.website,
    socialLinks: row.social_links || {},
    logoUrl: row.logo_url,
    enabled: row.enabled,
  };
}

/* ----------------------------------------------------------- notifications */

/**
 * Creates a notification for every active admin except the actor.
 *
 * One statement rather than a query per admin, and only the id, type, a title
 * and a short preview are stored — never a body.
 */
export async function createMailNotifications({ type = 'new_email', title, preview, messageId, threadId, excludeAdminId = null }) {
  await ensureMailSchema();
  const sql = db();

  // The recipient list is the set of administrators, which lives on the
  // application database. When the mailbox shares that database one statement
  // does the whole job; when it does not, the ids are resolved first and the
  // insert runs against the mailbox alone. Either way this is one query for the
  // recipient list and one insert — never a query per admin.
  if (!isMailDatabaseSeparate()) {
    const rows = await sql`
      INSERT INTO mail_notifications (admin_id, type, title, body_preview, message_id, thread_id)
      SELECT a.id, ${type}, ${title}, ${toSnippet(preview, 160)},
             ${messageId}::uuid, ${threadId}::uuid
      FROM admin_credentials a
      WHERE ${excludeAdminId}::uuid IS NULL OR a.id <> ${excludeAdminId}::uuid
      RETURNING id
    `;
    return rows.length;
  }

  const main = mainDb();
  const recipients = await main`
    SELECT id FROM admin_credentials
    WHERE ${excludeAdminId}::uuid IS NULL OR id <> ${excludeAdminId}::uuid
  `;
  if (!recipients.length) return 0;

  const ids = recipients.map((row) => row.id);
  const rows = await sql`
    INSERT INTO mail_notifications (admin_id, type, title, body_preview, message_id, thread_id)
    SELECT a, ${type}, ${title}, ${toSnippet(preview, 160)},
           ${messageId}::uuid, ${threadId}::uuid
    FROM unnest(${ids}::uuid[]) AS a
    RETURNING id
  `;
  return rows.length;
}

export async function listNotifications(adminId, { unreadOnly = false, limit = 20 } = {}) {
  await ensureMailSchema();
  const sql = db();
  const rows = unreadOnly
    ? await sql`
        SELECT id, type, title, body_preview, message_id, thread_id, is_read, created_at
        FROM mail_notifications
        WHERE admin_id = ${adminId}::uuid AND is_read = false
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT id, type, title, body_preview, message_id, thread_id, is_read, created_at
        FROM mail_notifications
        WHERE admin_id = ${adminId}::uuid
        ORDER BY created_at DESC LIMIT ${limit}
      `;
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    preview: row.body_preview,
    messageId: row.message_id,
    threadId: row.thread_id,
    isRead: row.is_read,
    createdAt: row.created_at,
  }));
}

export async function markNotificationsRead(adminId, ids = null) {
  await ensureMailSchema();
  const sql = db();
  if (ids && ids.length) {
    await sql`
      UPDATE mail_notifications SET is_read = true
      WHERE admin_id = ${adminId}::uuid AND id = ANY(${ids}::uuid[])
    `;
    return;
  }
  await sql`UPDATE mail_notifications SET is_read = true WHERE admin_id = ${adminId}::uuid AND is_read = false`;
}

export async function getNotificationSettings(adminId) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    SELECT * FROM mail_notification_settings WHERE admin_id = ${adminId}::uuid LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    // Defaults are returned without writing a row; the row appears on first save.
    return {
      notifyNewEmail: true,
      notifyProjectRequest: true,
      notifyReply: true,
      notifyImportant: true,
      desktopEnabled: false,
      soundEnabled: false,
      badgeEnabled: true,
    };
  }
  return {
    notifyNewEmail: row.notify_new_email,
    notifyProjectRequest: row.notify_project_request,
    notifyReply: row.notify_reply,
    notifyImportant: row.notify_important,
    desktopEnabled: row.desktop_enabled,
    soundEnabled: row.sound_enabled,
    badgeEnabled: row.badge_enabled,
  };
}

export async function saveNotificationSettings(adminId, fields) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    INSERT INTO mail_notification_settings (
      admin_id, notify_new_email, notify_project_request, notify_reply,
      notify_important, desktop_enabled, sound_enabled, badge_enabled
    ) VALUES (
      ${adminId}::uuid,
      ${fields.notifyNewEmail !== false}, ${fields.notifyProjectRequest !== false},
      ${fields.notifyReply !== false}, ${fields.notifyImportant !== false},
      ${fields.desktopEnabled === true}, ${fields.soundEnabled === true},
      ${fields.badgeEnabled !== false}
    )
    ON CONFLICT (admin_id) DO UPDATE SET
      notify_new_email = EXCLUDED.notify_new_email,
      notify_project_request = EXCLUDED.notify_project_request,
      notify_reply = EXCLUDED.notify_reply,
      notify_important = EXCLUDED.notify_important,
      desktop_enabled = EXCLUDED.desktop_enabled,
      sound_enabled = EXCLUDED.sound_enabled,
      badge_enabled = EXCLUDED.badge_enabled,
      updated_at = now()
    RETURNING *
  `;
  const row = rows[0];
  return {
    notifyNewEmail: row.notify_new_email,
    notifyProjectRequest: row.notify_project_request,
    notifyReply: row.notify_reply,
    notifyImportant: row.notify_important,
    desktopEnabled: row.desktop_enabled,
    soundEnabled: row.sound_enabled,
    badgeEnabled: row.badge_enabled,
  };
}

/* ------------------------------------------------------- push subscriptions */

export async function savePushSubscription(adminId, { endpoint, keys, userAgent = null }) {
  await ensureMailSchema();
  const sql = db();
  await sql`
    INSERT INTO push_subscriptions (admin_id, endpoint, p256dh, auth, user_agent)
    VALUES (${adminId}::uuid, ${endpoint}, ${keys?.p256dh || ''}, ${keys?.auth || ''}, ${userAgent})
    ON CONFLICT (endpoint) DO UPDATE SET
      admin_id = EXCLUDED.admin_id,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent,
      last_seen_at = now()
  `;
}

export async function deletePushSubscription(adminId, endpoint) {
  await ensureMailSchema();
  const sql = db();
  await sql`
    DELETE FROM push_subscriptions
    WHERE endpoint = ${endpoint} AND admin_id = ${adminId}::uuid
  `;
}

export async function listPushSubscriptions(adminId) {
  await ensureMailSchema();
  const sql = db();
  return sql`SELECT * FROM push_subscriptions WHERE admin_id = ${adminId}::uuid`;
}

/* ------------------------------------------------------------- audit trail */

/**
 * Records an important admin action.
 *
 * Only an action name and a small, non-sensitive detail object are stored;
 * bodies, provider keys and full addresses never reach this table.
 */
export async function recordAudit(adminId, action, { targetType = null, targetId = null, details = null } = {}) {
  try {
    await ensureMailSchema();
    const sql = db();
    await sql`
      INSERT INTO mail_audit_log (admin_id, action, target_type, target_id, details)
      VALUES (${adminId}, ${action}, ${targetType}, ${targetId}, ${details ? sql.json(details) : null})
    `;
  } catch (error) {
    // Auditing must never take down the action it describes.
    console.error('Mail audit write failed:', error.message);
  }
}

export async function listAudit(limit = 50) {
  await ensureMailSchema();
  const sql = db();
  const rows = await sql`
    SELECT id, action, target_type, target_id, details, created_at, admin_id
    FROM mail_audit_log
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  // The pin (a human-readable admin handle) lives on the application database.
  // Only the pins for the admins actually present on this page are resolved, so
  // this stays one extra query regardless of how large the log grows.
  const adminIds = [...new Set(rows.map((row) => row.admin_id).filter(Boolean))];
  let pins = {};
  if (adminIds.length) {
    const main = mainDb();
    const admins = await main`
      SELECT id, pin FROM admin_credentials WHERE id = ANY(${adminIds}::uuid[])
    `;
    pins = Object.fromEntries(admins.map((admin) => [admin.id, admin.pin]));
  }

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    details: row.details,
    createdAt: row.created_at,
    adminPin: row.admin_id ? pins[row.admin_id] ?? null : null,
  }));
}

/**
 * Removes every mail row belonging to an admin.
 *
 * Only needed when the mailbox is on its own database: there the
 * `admin_credentials` foreign keys cannot exist, so deleting an admin on the
 * application database does not cascade into the mail tables. On a shared
 * database the cascade already did this and the function does nothing.
 */
export async function purgeAdminMailData(adminId) {
  if (!adminId || !isMailDatabaseSeparate()) return { purged: false };
  await ensureMailSchema();
  const sql = db();
  // Ordered so a row is never deleted while a dependent still references it.
  await sql`DELETE FROM mail_notifications WHERE admin_id = ${adminId}::uuid`;
  await sql`DELETE FROM push_subscriptions WHERE admin_id = ${adminId}::uuid`;
  await sql`DELETE FROM mail_notification_settings WHERE admin_id = ${adminId}::uuid`;
  await sql`DELETE FROM mail_audit_log WHERE admin_id = ${adminId}::uuid`;
  await sql`DELETE FROM mail_drafts WHERE admin_id = ${adminId}::uuid`;
  await sql`DELETE FROM mail_signatures WHERE admin_id = ${adminId}::uuid`;
  await sql`UPDATE mail_templates SET created_by = NULL WHERE created_by = ${adminId}::uuid`;
  return { purged: true };
}

/**
 * Bootstraps the mailbox from records the public site already stores.
 *
 * Public contact submissions and project requests are sent through Resend and
 * are not otherwise kept in a mail-visible place, so their existing rows are
 * mirrored into the inbox. `sourceType`/`sourceId` make this idempotent, so
 * running it repeatedly never creates a second copy.
 */
export async function backfillFromProjectRequests() {
  await ensureMailSchema();
  const sql = db();

  // `project_requests` and `users` are application tables. When the mailbox is
  // separate they are read through the application connection, and only the
  // already-mirrored source ids are read from the mailbox to skip work.
  const source = isMailDatabaseSeparate() ? mainDb() : sql;

  let alreadyMirrored;
  if (isMailDatabaseSeparate()) {
    const seen = await sql`
      SELECT source_id FROM mail_messages WHERE source_type = 'project_request'
    `;
    alreadyMirrored = seen.map((row) => row.source_id);
  }

  const rows = alreadyMirrored
    ? await source`
        SELECT r.id, r.title, r.description, r.budget, r.timeline, r.technologies,
               r.created_at, u.email AS user_email, u.first_name, u.last_name
        FROM project_requests r
        LEFT JOIN users u ON u.id = r.user_id
        WHERE r.id::text <> ALL(${alreadyMirrored}::text[])
        ORDER BY r.created_at ASC
        LIMIT 100
      `
    : await source`
        SELECT r.id, r.title, r.description, r.budget, r.timeline, r.technologies,
               r.created_at, u.email AS user_email, u.first_name, u.last_name
        FROM project_requests r
        LEFT JOIN users u ON u.id = r.user_id
        WHERE NOT EXISTS (
          SELECT 1 FROM mail_messages m
          WHERE m.source_type = 'project_request' AND m.source_id = r.id::text
        )
        ORDER BY r.created_at ASC
        LIMIT 100
      `;

  let created = 0;
  for (const row of rows) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'ProjectHub user';
    const bodyLines = [
      row.description,
      row.budget ? `Budget: ${row.budget}` : null,
      row.timeline ? `Timeline: ${row.timeline}` : null,
      row.technologies?.length ? `Technologies: ${row.technologies.join(', ')}` : null,
    ].filter(Boolean);

    const result = await ingestMessage({
      direction: 'inbound',
      status: 'received',
      fromName: name,
      fromEmail: row.user_email,
      to: [],
      subject: `Project request: ${row.title}`,
      bodyText: bodyLines.join('\n\n'),
      provider: 'resend',
      sourceType: 'project_request',
      sourceId: String(row.id),
      sentAt: row.created_at,
    });
    if (!result.duplicate) created += 1;
  }
  return { scanned: rows.length, created };
}
