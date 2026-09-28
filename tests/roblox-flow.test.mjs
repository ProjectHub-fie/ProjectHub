/**
 * The Roblox / Bloxlink flow against a real database.
 *
 * Follows `auth-flow.test.mjs`: it is skipped, not failed, when `DATABASE_URL`
 * is absent, every row it writes is namespaced with a random per-run prefix, and
 * an `after` hook removes them. It exercises the parts that only a database can
 * prove — the schema, the cache read/write, the "no provider call inside the
 * TTL" rule, the outage-preserves-the-link rule, and the stats.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;
const hasDatabase = Boolean(databaseUrl);

// Namespaces every row this run writes, so a shared dev database is not
// polluted and the after hook can delete exactly what it created.
const prefix = `test-roblox-${Math.random().toString(36).slice(2, 10)}`;
const guildId = `${prefix}-guild`;

test('the Roblox integration flow', { skip: !hasDatabase ? 'DATABASE_URL is not set' : false }, async (t) => {
  process.env.BLOXLINK_API_KEY = process.env.BLOXLINK_API_KEY || 'test-key';
  process.env.BLOXLINK_GUILD_ID = process.env.BLOXLINK_GUILD_ID || '999999999999999999';

  const store = await import('../api/_lib/roblox-store.js');
  const service = await import('../api/_lib/roblox-service.js');
  const { ROBLOX_STATUS } = await import('../bot/lib/roblox-logic.js');
  const postgres = (await import('postgres')).default;
  const { normalizeDatabaseUrl, sslOptionForUrl } = await import('../api/_lib/db-url.js');
  const sql = postgres(normalizeDatabaseUrl(databaseUrl), { ssl: sslOptionForUrl(databaseUrl), max: 2 });

  t.after(async () => {
    await sql`DELETE FROM roblox_link_events WHERE guild_id = ${guildId}`;
    await sql`DELETE FROM roblox_links WHERE guild_id = ${guildId}`;
    await sql.end({ timeout: 5 });
    service.clearProfileCache();
  });

  await store.ensureRobloxSchema();

  await t.test('settings round-trip and coerce channel lists', async () => {
    const saved = await store.saveRobloxSettings({
      enabled: true,
      requireVerification: true,
      verifiedOnlyChannels: '111111111111111111, 222222222222222222',
    });
    assert.equal(saved.enabled, true);
    assert.equal(saved.requireVerification, true);
    assert.equal(saved.verifiedOnlyChannels, '111111111111111111,222222222222222222');

    const reread = await store.getRobloxSettings();
    assert.equal(reread.enabled, true);
    assert.equal(reread.verifiedOnlyChannels.includes('111111111111111111'), true);

    // Reset so the assertions are independent of lengthier runs.
    await store.saveRobloxSettings({ enabled: false, requireVerification: false });
  });

  await t.test('a link is cached, and a fresh cache skips the provider', async () => {
    const discordId = `${prefix}-u1`;
    await store.applyLinkResult({ guildId, discordId, result: { status: 'linked', robloxId: '156' } });

    const cached = await store.getCachedLink(guildId, discordId);
    assert.equal(cached.status, 'linked');
    assert.equal(cached.robloxId, '156');
    assert.ok(cached.linkedAt, 'a linked row records when it was first seen');
    assert.equal(service.isCacheFresh(cached), true);

    let calls = 0;
    const result = await service.checkMemberLink({
      guildId,
      discordId,
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, status: 200, json: async () => ({ robloxID: '156' }) };
      },
    });
    assert.equal(calls, 0, 'a fresh cache must not call Bloxlink');
    assert.equal(result.cached, true);
    assert.equal(result.status, ROBLOX_STATUS.LINKED);
  });

  await t.test('forcing a check does call the provider', async () => {
    const discordId = `${prefix}-u2`;
    await store.applyLinkResult({ guildId, discordId, result: { status: 'linked', robloxId: '42' } });

    let calls = 0;
    const result = await service.checkMemberLink({
      guildId,
      discordId,
      force: true,
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, status: 200, json: async () => ({ robloxID: '42' }) };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.cached, false);
  });

  await t.test('an outage preserves the last known link', async () => {
    const discordId = `${prefix}-u3`;
    await store.applyLinkResult({ guildId, discordId, result: { status: 'linked', robloxId: '99' } });

    const result = await service.checkMemberLink({
      guildId,
      discordId,
      force: true,
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    });
    assert.equal(result.status, ROBLOX_STATUS.BLOXLINK_UNAVAILABLE);
    assert.equal(result.robloxId, '99', 'the answer still carries the last known id');

    const row = await store.getCachedLink(guildId, discordId);
    assert.equal(row.status, 'linked', 'the outage did not overwrite the link');
    assert.equal(row.robloxId, '99');

    // And the TTL restarted, so the outage does not re-ask on every message.
    assert.equal(service.isCacheFresh(row), true);
  });

  await t.test('a stable link writes no extra log rows', async () => {
    const discordId = `${prefix}-u4`;
    await store.applyLinkResult({ guildId, discordId, result: { status: 'linked', robloxId: '7' } });
    const first = await store.listLinkEvents({ discordId });
    await store.applyLinkResult({ guildId, discordId, result: { status: 'linked', robloxId: '7' } });
    const second = await store.listLinkEvents({ discordId });
    assert.equal(first.length, 1);
    assert.equal(second.length, 1, 'a repeat check of an unchanged link writes nothing');
  });

  await t.test('stats count only what the cache can answer', async () => {
    const stats = await store.getRobloxStats({ guildId });
    assert.equal(stats.linked, 4);
    assert.equal(stats.tracked, 4);
    assert.equal(stats.verified, stats.linked, 'a link is a verified link');
  });

  await t.test('the linked-account list filters by status', async () => {
    const linked = await store.listLinks({ guildId, status: 'linked' });
    assert.equal(linked.length, 4);
    const unlinked = await store.listLinks({ guildId, status: 'not_linked' });
    assert.equal(unlinked.length, 0);
    assert.ok(linked.every((row) => row.guildId === guildId), 'the guild filter holds');
  });
});
