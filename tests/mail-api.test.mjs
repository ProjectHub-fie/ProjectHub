/**
 * Mail API shape and authorization.
 *
 * There is no DOM renderer and no guaranteed database here, so these pin the
 * invariants that a regression would break silently, by reading the source and by
 * exercising the pure helpers (address parsing, attachment validation).
 *
 * The security-relevant claims being pinned:
 *   - every /api/admin/mail route is behind an authenticated owner/admin guard;
 *   - public mail keeps using Resend and admin mail keeps using Mailjet, and
 *     neither can disable the other;
 *   - an unauthenticated inbound webhook is refused.
 */
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  prepareAttachments,
  parseAddressList,
} from '../api/lib/mail-routes.js';

const source = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('every mail route is registered behind the owner/admin guard', () => {
  const routes = source('api/lib/mail-routes.js');

  // The router must take the session guards and apply them to every route.
  assert.match(routes, /buildMailRouter\(\{\s*requireAuth,\s*requireRole,\s*adminIdFrom\s*\}\)/,
    'the mail router must be built from the dashboard session guards');
  assert.match(routes, /const requireMailAccess = requireRole\('admin'\)/,
    'mail access is owner/admin, not moderator');
  assert.match(routes, /const mailGuard = \[requireAuth, requireMailAccess, withAdmin\]/,
    'the guard chain must include authentication, the role check and the admin identity');

  // Every route declaration must spread the guard, so none can be added unguarded.
  const declarations = [...routes.matchAll(/router\.(get|post|patch|put|delete)\(\s*'([^']+)'([^\n]*)/g)];
  assert.ok(declarations.length >= 15, `expected the full mail surface, found ${declarations.length}`);
  for (const [full, method, path, rest] of declarations) {
    assert.match(
      rest,
      /mailGuard/,
      `${method.toUpperCase()} ${path} is not protected by mailGuard`,
    );
  }
});

test('the mail router is mounted in both backends', () => {
  const serverless = source('api/admin/index.js');
  const express = source('server/admin-routes.ts');

  for (const [label, body] of [['serverless', serverless], ['express', express]]) {
    assert.match(body, /buildMailRouter\(\{/, `${label} must mount the mail router`);
    assert.match(body, /adminIdFrom: \(req[^)]*\) => req\.session\?\.adminId/, `${label} must scope mail to the session admin`);
  }
});

test('public mail stays on Resend and admin mail stays on Mailjet', () => {
  const email = source('api/lib/email.js');

  // Two gates, two transports, deliberately not collapsed.
  assert.match(email, /export function isPublicEmailConfigured\(\) \{\s*return Boolean\(\s*process\.env\.RESEND_API_KEY/, 'public mail is gated on Resend');
  assert.match(email, /export function isPasswordResetEmailConfigured\(\)/, 'Mailjet has its own gate');
  assert.match(email, /export async function sendAdminEmail/, 'admin mail has a Mailjet sender');
  assert.match(email, /return mailjetSend\(message\)/, 'admin mail goes through Mailjet, not Resend');

  // The admin sender must not reach for Resend.
  const adminSender = email.slice(email.indexOf('export async function sendAdminEmail'));
  const adminBody = adminSender.slice(0, adminSender.indexOf('\n}\n'));
  assert.ok(!/sendPublicEmail|new Resend/.test(adminBody), 'sendAdminEmail must not send through Resend');
});

test('the contact form mirrors into the inbox without changing the Resend send', () => {
  const publicApi = source('api/index.js');

  // The Resend send must still be the thing that decides success.
  assert.match(publicApi, /const result = await sendPublicEmail\(/, 'contact mail still goes out via Resend');
  assert.match(publicApi, /if \(!result\.sent\)/, 'a failed Resend send still fails the form');
  assert.match(publicApi, /await ingestMessage\(\{/, 'the delivered message is mirrored into the inbox');

  // The mirror is best-effort: it must not be able to fail the public form.
  const mirror = publicApi.slice(publicApi.indexOf('Mirror the delivered message'));
  const catchBlock = mirror.slice(mirror.indexOf('catch'), mirror.indexOf('catch') + 260);
  assert.match(catchBlock, /console\.error/, 'a mirror failure is logged, not rethrown');

  // Preserved flows.
  for (const preserved of ['/api/auth/recovery', 'sendPasswordResetEmail', '/api/auth/discord/callback']) {
    assert.ok(publicApi.includes(preserved), `${preserved} must not be removed from the public API`);
  }
});

test('an inbound webhook is refused when no secret is configured', () => {
  const serverless = source('api/admin/index.js');
  const express = source('server/admin-routes.ts');

  for (const [label, body] of [['serverless', serverless], ['express', express]]) {
    const handler = body.slice(body.indexOf('MAIL_INBOUND_WEBHOOK_SECRET'));
    assert.match(handler, /503/, `${label} must refuse an unconfigured webhook`);
    assert.match(handler, /timingSafeEqual/, `${label} must compare the secret in constant time`);
    assert.match(handler, /401/, `${label} must reject a bad secret`);
  }
});

test('the inbound webhook is registered before the admin router', () => {
  const serverless = source('api/admin/index.js');
  const webhook = serverless.indexOf("app.post('/api/admin/mail/inbound'");
  const router = serverless.indexOf('const router = buildAdminRouter()');
  assert.ok(webhook !== -1 && router !== -1 && webhook < router,
    'the provider webhook must be mounted before the session-guarded router');
});

test('address parsing splits, trims, lowercases and deduplicates', () => {
  assert.deepEqual(parseAddressList('A@X.com, b@y.com; a@x.com'), ['a@x.com', 'b@y.com']);
  assert.deepEqual(parseAddressList(['One@x.com', ' two@y.com ']), ['one@x.com', 'two@y.com']);
  assert.deepEqual(parseAddressList(''), []);
  assert.deepEqual(parseAddressList(null), []);
});

test('attachment validation enforces the size and type limits', () => {
  const ok = prepareAttachments([
    { filename: 'a.pdf', contentType: 'application/pdf', base64Content: Buffer.from('hi').toString('base64') },
  ]);
  assert.equal(ok.error, null);
  assert.equal(ok.attachments.length, 1);
  assert.equal(ok.attachments[0].filename, 'a.pdf');

  const badType = prepareAttachments([
    { filename: 'x.exe', contentType: 'application/x-msdownload', base64Content: 'aGk=' },
  ]);
  assert.match(badType.error || '', /not allowed/i);

  const missing = prepareAttachments([{ filename: 'a.pdf', contentType: 'application/pdf' }]);
  assert.match(missing.error || '', /filename and content/i);

  const huge = prepareAttachments([
    {
      filename: 'big.bin',
      contentType: 'application/pdf',
      base64Content: 'a'.repeat(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 64),
    },
  ]);
  assert.match(huge.error || '', /5 MB/);

  assert.equal(prepareAttachments([]).error, null);
  assert.equal(prepareAttachments(undefined).error, null);
});

test('the attachment allow-list does not include executable types', () => {
  for (const type of ALLOWED_ATTACHMENT_TYPES) {
    assert.ok(
      !/(executable|msdownload|x-sh|octet-stream|javascript|html)/.test(type),
      `${type} should not be an accepted attachment type`,
    );
  }
});

test('attachments are served as downloads with nosniff', () => {
  const routes = source('api/lib/mail-routes.js');
  const handler = routes.slice(routes.indexOf("attachments/:id"));
  assert.match(handler, /Content-Disposition.*attachment/, 'a download, never inline rendering');
  assert.match(handler, /X-Content-Type-Options.*nosniff/, 'the declared type is enforced');
});

test('mail data-layer queries stay paginated and body-free in lists', () => {
  const store = source('api/lib/mail-store.js');

  // List queries must not select the body columns.
  const listColumns = store.slice(store.indexOf('const LIST_COLUMNS'), store.indexOf('export async function listMessages'));
  assert.ok(!/body_html|body_text/.test(listColumns), 'list rows must not carry full bodies');
  assert.match(store, /LIMIT \$\{limit\} OFFSET \$\{offset\}/, 'lists are paginated');
  assert.match(store, /Math\.min\(Math\.max\(Number\(pageSize\) \|\| 25, 1\), 100\)/, 'page size is bounded');

  // Counts must be one aggregate, not several round trips.
  assert.match(store, /COUNT\(\*\) FILTER \(WHERE/, 'unread counts use a single aggregate');

  // Ingestion must be idempotent on the provider message id.
  assert.match(store, /WHERE provider_message_id = \$\{providerId\} LIMIT 1/, 'ingestion checks for a duplicate first');
  assert.match(store, /CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_provider_message_idx/, 'the database enforces idempotency too');
});

test('notification rows never store a full body', () => {
  const store = source('api/lib/mail-store.js');
  const insert = store.slice(store.indexOf('export async function createMailNotifications'), store.indexOf('export async function listNotifications'));

  assert.match(insert, /toSnippet\(preview, 160\)/, 'only a short preview is stored');
  assert.ok(!/body_html|body_text/.test(insert), 'notifications must not carry a message body');
  assert.match(insert, /SELECT a\.id, \$\{type\}/, 'one statement writes every admin, not one query per admin');
});
