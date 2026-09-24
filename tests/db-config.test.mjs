/**
 * Database connection configuration.
 *
 * These cover the parts of the connection path that do not need a live
 * database: how the URL is normalised before the driver sees it, how driver
 * failures are classified, and that no credential file is committed. They run
 * with the placeholder DATABASE_URL that helpers/env.mjs installs.
 */
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeDatabaseUrl, findDbErrorCode, describeDbError } from '../api/lib/db.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const NEON_URL =
  'postgresql://neondb_owner:secret@ep-flat-smoke-ahi3peq6-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

test('normalizeDatabaseUrl strips channel_binding, which postgres.js cannot honour', () => {
  const normalized = new URL(normalizeDatabaseUrl(NEON_URL));
  assert.equal(normalized.searchParams.has('channel_binding'), false);
});

test('normalizeDatabaseUrl rewrites the deprecated SSL modes to verify-full', () => {
  // pg-connection-string treats prefer/require/verify-ca as verify-full anyway,
  // but warns on them and will adopt weaker libpq semantics next major. Writing
  // verify-full keeps today's behaviour and silences a misleading warning.
  for (const mode of ['prefer', 'require', 'verify-ca']) {
    const normalized = new URL(normalizeDatabaseUrl(NEON_URL.replace('sslmode=require', `sslmode=${mode}`)));
    assert.equal(normalized.searchParams.get('sslmode'), 'verify-full', `${mode} must become verify-full`);
  }
});

test('normalizeDatabaseUrl leaves verify-full and disable untouched', () => {
  const full = normalizeDatabaseUrl('postgresql://user:pw@host:5432/db?sslmode=verify-full');
  assert.equal(new URL(full).searchParams.get('sslmode'), 'verify-full');
  const disabled = normalizeDatabaseUrl('postgresql://user:pw@host:5432/db?sslmode=disable');
  assert.equal(new URL(disabled).searchParams.get('sslmode'), 'disable');
});

test('normalizeDatabaseUrl preserves the parameters that still matter', () => {
  const normalized = new URL(normalizeDatabaseUrl(NEON_URL));
  assert.equal(normalized.searchParams.get('sslmode'), 'verify-full');
  assert.equal(normalized.host, 'ep-flat-smoke-ahi3peq6-pooler.c-3.us-east-1.aws.neon.tech');
  assert.equal(normalized.username, 'neondb_owner');
  assert.equal(normalized.pathname, '/neondb');
});

test('normalizeDatabaseUrl leaves an already-clean URL alone', () => {
  const clean = 'postgresql://user:pw@host:5432/db?sslmode=verify-full';
  assert.equal(normalizeDatabaseUrl(clean), clean);
});

test('normalizeDatabaseUrl passes non-URL input through untouched', () => {
  assert.equal(normalizeDatabaseUrl('not a url'), 'not a url');
  assert.equal(normalizeDatabaseUrl(''), '');
  assert.equal(normalizeDatabaseUrl(undefined), undefined);
});

test('findDbErrorCode follows the cause chain Drizzle wraps driver errors in', () => {
  const driverError = Object.assign(new Error('password authentication failed'), { code: '28P01' });
  const wrapped = Object.assign(new Error('Failed query'), { cause: driverError });
  assert.equal(findDbErrorCode(wrapped), '28P01');
});

test('findDbErrorCode does not loop forever on a cyclic cause chain', () => {
  const a = new Error('a');
  const b = Object.assign(new Error('b'), { cause: a });
  a.cause = b;
  assert.equal(findDbErrorCode(a), undefined);
});

test('describeDbError reports a rejected password without leaking the connection string', () => {
  const driverError = Object.assign(new Error(`password authentication failed: ${NEON_URL}`), {
    code: '28P01',
  });
  const wrapped = Object.assign(new Error(`Failed query: ${NEON_URL}`), { cause: driverError });
  const summary = describeDbError(wrapped);

  assert.equal(summary, 'Database rejected the configured credentials');
  assert.ok(!summary.includes('neondb_owner'), 'the role name must not be echoed');
  assert.ok(!summary.includes('ep-flat-smoke'), 'the connection host must not be echoed');
});

test('no credential file is tracked in git', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  const leaked = tracked.filter((path) => {
    const name = path.split('/').pop();
    return name === '.env' || name.startsWith('.env.') || name === '.env.local';
  });

  assert.deepEqual(leaked, [], `credential files must never be committed: ${leaked.join(', ')}`);
});

test('the connection points normalize the URL before the driver sees it', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

  assert.match(read('api/lib/db.js'), /postgres\(connectionUrl/,
    'api/lib/db.js must connect with the normalized URL');
  assert.match(read('api/admin/index.js'), /postgres\(normalizeDatabaseUrl\(process\.env\.DATABASE_URL\)/,
    'the admin function must normalize its URL');
  assert.match(read('api/admin/index.js'), /conString: normalizeDatabaseUrl\(process\.env\.DATABASE_URL\)/,
    'the admin session store must normalize its URL');
});
