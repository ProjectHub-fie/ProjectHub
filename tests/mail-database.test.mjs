/**
 * Mailbox connection resolution.
 *
 * `MAIL_DATABASE_URL` lets the mailbox sit on its own database. These pin the
 * resolution rules and the guards that keep a split deployment correct, without
 * needing a live database: importing api/_lib/mail-store.js opens no connection
 * (postgres.js connects lazily on the first query).
 */
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mailDbUrl = 'postgresql://mail:secret@mail-host:5432/projecthub_mail';

const withMailDb = async (value, fn) => {
  const previous = process.env.MAIL_DATABASE_URL;
  const previousMain = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://app:secret@app-host:5432/projecthub';
  if (value === undefined) delete process.env.MAIL_DATABASE_URL;
  else process.env.MAIL_DATABASE_URL = value;
  try {
    // Re-imported fresh so the module re-reads process.env each time.
    const mod = await import(`../api/_lib/mail-store.js?case=${Math.random()}`);
    return await fn(mod);
  } finally {
    if (previous === undefined) delete process.env.MAIL_DATABASE_URL;
    else process.env.MAIL_DATABASE_URL = previous;
    if (previousMain === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousMain;
  }
};

test('mailDatabaseUrl falls back to DATABASE_URL when MAIL_DATABASE_URL is unset', async () => {
  await withMailDb(undefined, (mod) => {
    assert.equal(mod.mailDatabaseUrl(), 'postgresql://app:secret@app-host:5432/projecthub');
    assert.equal(mod.isMailDatabaseSeparate(), false);
  });
});

test('mailDatabaseUrl prefers MAIL_DATABASE_URL when it is set', async () => {
  await withMailDb(mailDbUrl, (mod) => {
    assert.equal(mod.mailDatabaseUrl(), mailDbUrl);
    assert.equal(mod.isMailDatabaseSeparate(), true);
  });
});

test('a MAIL_DATABASE_URL identical to DATABASE_URL is not treated as separate', async () => {
  const shared = 'postgresql://app:secret@app-host:5432/projecthub';
  await withMailDb(shared, (mod) => {
    assert.equal(mod.isMailDatabaseSeparate(), false);
  });
});

test('the mail connection normalizes its URL and is lazy', () => {
  const store = readFileSync(new URL('../api/_lib/mail-store.js', import.meta.url), 'utf8');
  assert.match(store, /postgres\(normalizeDatabaseUrl\(mailDatabaseUrl\(\)\)/,
    'the mail pool must normalize whichever URL it resolves');
});

test('admin foreign keys are conditional on the databases being shared', () => {
  const store = readFileSync(new URL('../api/_lib/mail-store.js', import.meta.url), 'utf8');
  assert.match(store, /isMailDatabaseSeparate\(\)[\s\S]{0,80}sql\.unsafe\(''\)/,
    'a split mailbox must omit the cross-database admin foreign key');
  assert.match(store, /REFERENCES admin_credentials\(id\) ON DELETE/,
    'a shared mailbox must keep the cascade foreign key');
});

test('the admin delete route purges mail rows for a split mailbox', () => {
  const admin = readFileSync(new URL('../api/admin/index.js', import.meta.url), 'utf8');
  assert.match(admin, /purgeAdminMailData\(id\)/,
    'deleting an admin must clean up mail rows the cascade cannot reach');
});

test('the mailbox DDL and drizzle/schema.ts agree on every mail_messages column', () => {
  // `scripts/db-bootstrap.mjs` derives its DDL from drizzle/schema.ts, while the
  // mailbox creates and queries its own tables in mail-store.js. If the two
  // disagree on a column name, a bootstrapped database gets a column the mailbox
  // never reads and every ingest fails with 42703 — which is exactly what the
  // old `references` vs `message_references` split did.
  const store = readFileSync(new URL('../api/_lib/mail-store.js', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');

  const mailboxBlock = store.slice(
    store.indexOf('CREATE TABLE IF NOT EXISTS mail_messages'),
    store.indexOf('CREATE TABLE IF NOT EXISTS mail_attachments'),
  );
  const schemaBlock = schema.slice(
    schema.indexOf("pgTable('mail_messages'"),
    schema.indexOf("pgTable('mail_attachments'"),
  );

  const mailboxColumns = new Set([...mailboxBlock.matchAll(/^\s{4,}([a-z_]+) (?:uuid|text|boolean|integer|timestamp|jsonb)/gm)].map((m) => m[1]));
  const schemaColumns = new Set([...schemaBlock.matchAll(/\w+\((?:'|\")([a-z_]+)(?:'|\")\)/g)].map((m) => m[1]));

  assert.ok(mailboxColumns.size > 15, 'the mailbox column list was parsed');
  const missing = [...mailboxColumns].filter((c) => !schemaColumns.has(c));
  assert.deepEqual(missing, [], `drizzle/schema.ts is missing mail_messages columns: ${missing.join(', ')}`);

  // `references` is reserved, so the column is `message_references`; the JS field
  // in schema.ts keeps the header name. Guard the name itself, not just presence.
  assert.match(schema, /text\('message_references'\)/, 'schema.ts must use the mailbox column name');
  assert.ok(!/text\('references'\)\.array/.test(schema), 'the old reserved-word column name must be gone');
  assert.match(store, /RENAME COLUMN \"references\" TO message_references/,
    'a pre-fix database must be healed in place');
});
