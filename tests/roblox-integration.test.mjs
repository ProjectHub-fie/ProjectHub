/**
 * The Roblox / Bloxlink integration: the status vocabulary, the command parsing,
 * the embed shapes, the feature gate, the cache TTL rule, and the dashboard
 * wiring.
 *
 * The pure helpers are exercised directly — they import nothing from discord.js
 * or a database driver on purpose. The wiring is read from source, the same
 * approach `discord-bot.test.mjs` uses, because no gateway or database is
 * available to the runner. The provider clients are exercised with a stub
 * `fetchImpl`, so the request shape, the error mapping and the "not linked vs
 * unavailable" distinction are checked without network access.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = (relative) => readFileSync(resolve(root, relative), 'utf8');

const {
  ROBLOX_STATUS,
  ROBLOX_COMMAND,
  ROBLOX_SUBCOMMANDS,
  isValidRobloxId,
  isValidRobloxUsername,
  robloxProfileUrl,
  robloxStatusLabel,
  robloxStatusField,
  isLinkedStatus,
  normalizeStatus,
  isRobloxCommand,
  parseRobloxSubcommand,
  discordIdFromArg,
  robloxProfileField,
  buildRobloxProfileEmbed,
  buildRobloxUnlinkedEmbed,
  buildRobloxLookupEmbed,
  buildRobloxLookupMissingEmbed,
  buildRobloxVerifyEmbed,
  buildRobloxUnlinkEmbed,
  buildRobloxUsageEmbed,
} = await import('../bot/lib/roblox-logic.js');

const { buildProfileEmbed } = await import('../bot/lib/bot-logic.js');
const { lookupBloxlinkLink, resolveRobloxUsername, fetchRobloxProfile, isBloxlinkConfigured, bloxlinkGuildId } =
  await import('../api/_lib/roblox-client.js');
const { isCacheFresh, evaluateFeatureAccess, isVerifiedOnlyChannel, featureAccessMessage, ROBLOX_CACHE_TTL_MS } =
  await import('../api/_lib/roblox-service.js');

/* --------------------------------------------------------------- validation */

test('a Roblox id is a decimal string and nothing else', () => {
  assert.equal(isValidRobloxId('156'), true);
  assert.equal(isValidRobloxId('12345678901234567890'), true);
  assert.equal(isValidRobloxId(''), false);
  assert.equal(isValidRobloxId('abc'), false);
  assert.equal(isValidRobloxId('1;2'), false);
  assert.equal(isValidRobloxId('../../etc'), false);
  assert.equal(isValidRobloxId(null), false);
});

test('a Roblox username is bounded to the characters Roblox allows', () => {
  assert.equal(isValidRobloxUsername('builderman'), true);
  assert.equal(isValidRobloxUsername('A_1_b'), true);
  assert.equal(isValidRobloxUsername('ab'), false, 'too short');
  assert.equal(isValidRobloxUsername('a'.repeat(21)), false, 'too long');
  assert.equal(isValidRobloxUsername('has space'), false);
  assert.equal(isValidRobloxUsername('../../x'), false);
  assert.equal(isValidRobloxUsername(''), false);
});

test('a profile URL is only built for a valid id', () => {
  assert.equal(robloxProfileUrl('156'), 'https://www.roblox.com/users/156/profile');
  assert.equal(robloxProfileUrl('nope'), null);
});

/* ------------------------------------------------------------------ statuses */

test('the four statuses are distinct and never merged', () => {
  assert.deepEqual(Object.values(ROBLOX_STATUS).sort(), [
    'bloxlink_unavailable',
    'linked',
    'not_linked',
    'verification_unavailable',
  ]);
  assert.equal(robloxStatusLabel(ROBLOX_STATUS.LINKED), 'Linked');
  assert.equal(robloxStatusLabel(ROBLOX_STATUS.NOT_LINKED), 'Not Linked');
  assert.equal(robloxStatusLabel(ROBLOX_STATUS.VERIFICATION_UNAVAILABLE), 'Verification unavailable');
  assert.equal(robloxStatusLabel(ROBLOX_STATUS.BLOXLINK_UNAVAILABLE), 'Bloxlink unavailable');
});

test('only a confirmed link counts as linked', () => {
  assert.equal(isLinkedStatus(ROBLOX_STATUS.LINKED), true);
  for (const other of [ROBLOX_STATUS.NOT_LINKED, ROBLOX_STATUS.VERIFICATION_UNAVAILABLE, ROBLOX_STATUS.BLOXLINK_UNAVAILABLE]) {
    assert.equal(isLinkedStatus(other), false);
  }
});

test('an unknown status becomes "verification unavailable", never "not linked"', () => {
  // The important direction: a failure must not read as a definite "not linked".
  assert.equal(normalizeStatus('garbage'), ROBLOX_STATUS.VERIFICATION_UNAVAILABLE);
  assert.equal(normalizeStatus(undefined), ROBLOX_STATUS.VERIFICATION_UNAVAILABLE);
  assert.equal(normalizeStatus(null), ROBLOX_STATUS.VERIFICATION_UNAVAILABLE);
  assert.equal(normalizeStatus(ROBLOX_STATUS.LINKED), ROBLOX_STATUS.LINKED);
  assert.equal(normalizeStatus(ROBLOX_STATUS.NOT_LINKED), ROBLOX_STATUS.NOT_LINKED);
});

test('the field wording distinguishes the four states', () => {
  assert.equal(robloxStatusField(ROBLOX_STATUS.LINKED), '✓ Linked');
  assert.equal(robloxStatusField(ROBLOX_STATUS.NOT_LINKED), '○ Not Linked');
  assert.equal(robloxStatusField(ROBLOX_STATUS.VERIFICATION_UNAVAILABLE), '⚠ Verification unavailable');
  assert.equal(robloxStatusField(ROBLOX_STATUS.BLOXLINK_UNAVAILABLE), '⚠ Bloxlink unavailable');
});

/* ----------------------------------------------------------- command parsing */

test('roblox is the command and its subcommands are fixed', () => {
  assert.equal(ROBLOX_COMMAND, 'roblox');
  assert.deepEqual(ROBLOX_SUBCOMMANDS, ['profile', 'lookup', 'verify', 'unlink', 'status']);
  assert.equal(isRobloxCommand('roblox'), true);
  assert.equal(isRobloxCommand('robloxx'), false);
  assert.equal(isRobloxCommand('profile'), false);
});

test('a bare &roblox is the profile subcommand, like &roblox profile', () => {
  assert.deepEqual(parseRobloxSubcommand([]), { subcommand: 'profile', args: [], unknown: null });
  assert.deepEqual(parseRobloxSubcommand(['profile']), { subcommand: 'profile', args: [], unknown: null });
  assert.deepEqual(parseRobloxSubcommand(['lookup', 'builderman']), {
    subcommand: 'lookup',
    args: ['builderman'],
    unknown: null,
  });
});

test('the subcommand is case-insensitive and an unknown one is reported', () => {
  assert.equal(parseRobloxSubcommand(['LOOKUP', 'x']).subcommand, 'lookup');
  assert.equal(parseRobloxSubcommand(['bogus']).subcommand, null);
  assert.equal(parseRobloxSubcommand(['bogus']).unknown, 'bogus');
});

test('a Discord id is read from a raw id or a mention, and never half-parsed', () => {
  assert.equal(discordIdFromArg('123456789012345678'), '123456789012345678');
  assert.equal(discordIdFromArg('<@123456789012345678>'), '123456789012345678');
  assert.equal(discordIdFromArg('<@!123456789012345678>'), '123456789012345678');
  assert.equal(discordIdFromArg('@123456789012345678'), null);
  assert.equal(discordIdFromArg('prefix123456789012345678'), null);
  assert.equal(discordIdFromArg('12345'), null, 'too short to be a snowflake');
  assert.equal(discordIdFromArg(''), null);
});

/* --------------------------------------------------------------- embeds */

test('the linked profile embed carries every required field', () => {
  const embed = buildRobloxProfileEmbed({
    discordName: '@ExampleUser',
    robloxUsername: 'ExamplePlayer',
    robloxDisplayName: 'Example',
    robloxUserId: '123456789',
    status: ROBLOX_STATUS.LINKED,
  });
  const names = embed.fields.map((f) => f.name);
  assert.ok(names.includes('🎮 Roblox'));
  assert.ok(names.includes('📛 Display Name'));
  assert.ok(names.includes('🆔 User ID'));
  assert.ok(names.includes('📅 Account Created'));
  assert.ok(names.includes('🔗 Bloxlink'));
  assert.ok(names.includes('🌐 Profile'));
  assert.equal(embed.fields.find((f) => f.name === '🆔 User ID').value, '123456789');
  assert.equal(embed.fields.find((f) => f.name === '🔗 Bloxlink').value, '✓ Linked');
  assert.match(embed.fields.find((f) => f.name === '🌐 Profile').value, /users\/123456789\/profile/);
});

test('no embed field can render undefined, null or NaN', () => {
  const embed = buildRobloxProfileEmbed({
    discordName: null,
    robloxUsername: 'Someone',
    robloxUserId: '1',
    accountCreated: null,
  });
  const text = JSON.stringify(embed);
  assert.ok(!/undefined/.test(text), 'no undefined leaked');
  assert.ok(!/\bnull\b/.test(text), 'no null leaked');
  assert.ok(!/NaN/.test(text), 'no NaN leaked');
});

test('the unlinked embed says "not linked", and an outage says something else', () => {
  const notLinked = buildRobloxUnlinkedEmbed({ discordName: '@ExampleUser', status: ROBLOX_STATUS.NOT_LINKED });
  assert.match(notLinked.description, /has not linked a Roblox account through Bloxlink/);
  assert.match(notLinked.description, /Usernames alone are never treated as proof/);
  assert.equal(notLinked.fields[0].value, '○ Not Linked');

  const outage = buildRobloxUnlinkedEmbed({ discordName: '@ExampleUser', status: ROBLOX_STATUS.BLOXLINK_UNAVAILABLE });
  assert.match(outage.description, /could not check Bloxlink/);
  assert.match(outage.description, /not a "not linked" answer/);
  assert.ok(!/has not linked/.test(outage.description), 'an outage must not read as a definite no');
});

test('the public lookup embed is labelled as not a link', () => {
  const embed = buildRobloxLookupEmbed({ robloxUsername: 'builderman', robloxUserId: '156' });
  assert.match(embed.description, /does not link the account to Discord/);
  assert.equal(embed.title, '🔎 Roblox Lookup');
});

test('a missing username gets an explicit empty result, not a crash', () => {
  const embed = buildRobloxLookupMissingEmbed({ username: 'nobody' });
  assert.match(embed.description, /No Roblox account named/);
});

test('verify points at Bloxlink and adapts to the current status', () => {
  const notLinked = buildRobloxVerifyEmbed({ discordName: '@x', status: ROBLOX_STATUS.NOT_LINKED });
  assert.match(notLinked.description, /Bloxlink/);
  assert.equal(notLinked.title, '🎮 Bloxlink Verification');

  const linked = buildRobloxVerifyEmbed({ discordName: '@x', status: ROBLOX_STATUS.LINKED });
  assert.match(linked.description, /already has a Roblox account linked/);

  const outage = buildRobloxVerifyEmbed({ discordName: '@x', status: ROBLOX_STATUS.BLOXLINK_UNAVAILABLE });
  assert.match(outage.description, /could not reach Bloxlink/);
});

test('unlink defers to Bloxlink rather than pretending to unlink', () => {
  const embed = buildRobloxUnlinkEmbed({});
  assert.match(embed.description, /through Bloxlink, not through this bot/);
});

test('the usage embed lists every subcommand', () => {
  const embed = buildRobloxUsageEmbed({ prefix: '&' });
  for (const sub of ROBLOX_SUBCOMMANDS) {
    assert.ok(embed.description.includes(`roblox ${sub}`), `usage mentions ${sub}`);
  }
});

test('the compact profile field is only produced for a confirmed link', () => {
  assert.equal(robloxProfileField({ robloxUsername: 'x', status: ROBLOX_STATUS.NOT_LINKED }), null);
  assert.equal(robloxProfileField({ robloxUsername: 'x', status: ROBLOX_STATUS.BLOXLINK_UNAVAILABLE }), null);
  assert.equal(robloxProfileField({ status: ROBLOX_STATUS.LINKED }), null, 'no username, no field');

  const field = robloxProfileField({ robloxUsername: 'ExamplePlayer', status: ROBLOX_STATUS.LINKED });
  assert.equal(field.name, '🎮 Roblox');
  assert.equal(field.value, '`ExamplePlayer`\n✓ Bloxlink Verified');
});

test('displayMode=full adds the account id, compact does not', () => {
  const compact = robloxProfileField({ robloxUsername: 'P', robloxUserId: '156', status: ROBLOX_STATUS.LINKED });
  assert.ok(!compact.value.includes('156'));
  const full = robloxProfileField({ robloxUsername: 'P', robloxUserId: '156', status: ROBLOX_STATUS.LINKED, mode: 'full' });
  assert.match(full.value, /🆔 156/);
});

/* ------------------------------------------------- existing profile stays intact */

test('an unlinked member profile is unchanged by the Roblox feature', () => {
  const fixed = { requestedAt: new Date('2026-09-28T12:00:00Z'), now: Date.parse('2026-09-28T12:00:00Z') };
  const withoutRoblox = buildProfileEmbed({ displayName: 'A', username: 'a', role: 'member', ...fixed });
  const withNull = buildProfileEmbed({ displayName: 'A', username: 'a', role: 'member', robloxField: null, ...fixed });
  assert.deepEqual(withNull, withoutRoblox);
  // The existing fields are all still present, in order.
  assert.deepEqual(
    withoutRoblox.fields.map((f) => f.name),
    ['👤 Name', '🏷️ Username', '🛡️ Role', '📅 Account Created', '📅 Server Joined', '🤝 Invited By', '🔗 Discord Linked'],
  );
});

test('a linked member profile gains exactly one Roblox field, at the end', () => {
  const embed = buildProfileEmbed({
    displayName: 'A',
    username: 'a',
    role: 'member',
    robloxField: robloxProfileField({ robloxUsername: 'ExamplePlayer', status: ROBLOX_STATUS.LINKED }),
  });
  assert.equal(embed.fields.length, 8);
  assert.equal(embed.fields.at(-1).name, '🎮 Roblox');
});

/* ------------------------------------------------------------- feature gate */

test('nothing is required when the integration is off', () => {
  const access = evaluateFeatureAccess({ settings: { enabled: false, requireVerification: true }, status: ROBLOX_STATUS.NOT_LINKED });
  assert.equal(access.required, false);
  assert.equal(access.allowed, true);
});

test('nothing is required when verification is not required', () => {
  const access = evaluateFeatureAccess({ settings: { enabled: true, requireVerification: false }, status: ROBLOX_STATUS.NOT_LINKED });
  assert.equal(access.required, false);
  assert.equal(access.allowed, true);
});

test('a verified member passes and an unlinked member is refused', () => {
  const settings = { enabled: true, requireVerification: true };
  assert.equal(evaluateFeatureAccess({ settings, status: ROBLOX_STATUS.LINKED }).allowed, true);
  const refused = evaluateFeatureAccess({ settings, status: ROBLOX_STATUS.NOT_LINKED });
  assert.equal(refused.allowed, false);
  assert.equal(refused.reason, 'not_linked');
});

test('an outage refuses non-staff, but says why', () => {
  const settings = { enabled: true, requireVerification: true };
  const unavailable = evaluateFeatureAccess({ settings, status: ROBLOX_STATUS.BLOXLINK_UNAVAILABLE });
  assert.equal(unavailable.allowed, false);
  assert.equal(unavailable.reason, 'bloxlink_unavailable');
  assert.match(featureAccessMessage('bloxlink_unavailable'), /could not be reached/);
  assert.match(featureAccessMessage('not_linked'), /Roblox Verified required/);
});

test('staff always pass, so an outage cannot lock an administrator out', () => {
  const settings = { enabled: true, requireVerification: true };
  for (const status of Object.values(ROBLOX_STATUS)) {
    const access = evaluateFeatureAccess({ settings, status, isStaff: true });
    assert.equal(access.allowed, true, `staff passes with status ${status}`);
    assert.equal(access.reason, 'staff');
  }
});

test('a channel is gated only when it is listed and verification is required', () => {
  assert.equal(isVerifiedOnlyChannel({ requireVerification: true, verifiedOnlyChannels: '1,2,3' }, '2'), true);
  assert.equal(isVerifiedOnlyChannel({ requireVerification: true, verifiedOnlyChannels: '1,2,3' }, '9'), false);
  assert.equal(isVerifiedOnlyChannel({ requireVerification: false, verifiedOnlyChannels: '1,2,3' }, '2'), false);
  assert.equal(isVerifiedOnlyChannel({ requireVerification: true, verifiedOnlyChannels: '' }, '2'), false);
});

/* ------------------------------------------------------------------- cache */

test('the cache TTL is honest about fresh vs stale', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  assert.equal(isCacheFresh({ lastCheckedAt: new Date(now - 1000) }, now), true);
  assert.equal(isCacheFresh({ lastCheckedAt: new Date(now - ROBLOX_CACHE_TTL_MS - 1) }, now), false);
  assert.equal(isCacheFresh({ lastCheckedAt: null }, now), false);
  assert.equal(isCacheFresh(null, now), false);
});

/* --------------------------------------------------------- Bloxlink client */

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('a linked member resolves the Roblox id from Bloxlink', async () => {
  const result = await lookupBloxlinkLink({
    discordId: '123456789012345678',
    guildId: '999999999999999999',
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      assert.match(url, /\/v4\/public\/guilds\/999999999999999999\/discord-to-roblox\/123456789012345678$/);
      assert.equal(options.headers.Authorization, 'test-key');
      return jsonResponse(200, { robloxID: '156' });
    },
  });
  assert.equal(result.status, ROBLOX_STATUS.LINKED);
  assert.equal(result.robloxId, '156');
});

test('"User not found" is a definite not_linked, not an outage', async () => {
  const result = await lookupBloxlinkLink({
    discordId: '1',
    guildId: '2',
    apiKey: 'k',
    fetchImpl: async () => jsonResponse(400, { error: 'User not found' }),
  });
  assert.equal(result.status, ROBLOX_STATUS.NOT_LINKED);
});

test('a bad key is verification_unavailable, never not_linked', async () => {
  for (const error of ['Invalid API Key', 'You must provide an api-key']) {
    const result = await lookupBloxlinkLink({
      discordId: '1',
      guildId: '2',
      apiKey: 'k',
      fetchImpl: async () => jsonResponse(400, { error }),
    });
    assert.equal(result.status, ROBLOX_STATUS.VERIFICATION_UNAVAILABLE);
    assert.equal(result.reason, 'invalid_key');
  }
});

test('rate limiting is verification_unavailable, a 500 is bloxlink_unavailable', async () => {
  const limited = await lookupBloxlinkLink({
    discordId: '1',
    guildId: '2',
    apiKey: 'k',
    fetchImpl: async () => jsonResponse(429, {}),
  });
  assert.equal(limited.status, ROBLOX_STATUS.VERIFICATION_UNAVAILABLE);
  assert.equal(limited.reason, 'rate_limited');

  const down = await lookupBloxlinkLink({
    discordId: '1',
    guildId: '2',
    apiKey: 'k',
    fetchImpl: async () => jsonResponse(503, {}),
  });
  assert.equal(down.status, ROBLOX_STATUS.BLOXLINK_UNAVAILABLE);
});

test('a network failure is bloxlink_unavailable and never throws', async () => {
  const result = await lookupBloxlinkLink({
    discordId: '1',
    guildId: '2',
    apiKey: 'k',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(result.status, ROBLOX_STATUS.BLOXLINK_UNAVAILABLE);
  assert.equal(result.reason, 'network_error');
});

test('a missing key or guild cannot produce a link', async () => {
  assert.equal((await lookupBloxlinkLink({ discordId: '1', apiKey: '', guildId: '2' })).status, ROBLOX_STATUS.VERIFICATION_UNAVAILABLE);
  assert.equal((await lookupBloxlinkLink({ discordId: '1', apiKey: 'k', guildId: null })).status, ROBLOX_STATUS.VERIFICATION_UNAVAILABLE);
});

test('a success with an unusable id is verification_unavailable, not a link', async () => {
  const result = await lookupBloxlinkLink({
    discordId: '1',
    guildId: '2',
    apiKey: 'k',
    fetchImpl: async () => jsonResponse(200, { robloxID: 'not-a-number' }),
  });
  assert.equal(result.status, ROBLOX_STATUS.VERIFICATION_UNAVAILABLE);
  assert.equal(result.reason, 'unexpected_payload');
});

test('the key and guild are read from the environment only', () => {
  assert.equal(isBloxlinkConfigured({ BLOXLINK_API_KEY: 'x' }), true);
  assert.equal(isBloxlinkConfigured({}), false);
  assert.equal(bloxlinkGuildId({ BLOXLINK_GUILD_ID: '123456789012345678' }), '123456789012345678');
  assert.equal(bloxlinkGuildId({ BLOXLINK_GUILD_ID: 'nope' }), null);
  assert.equal(bloxlinkGuildId({}), null);
});

/* ----------------------------------------------------------- Roblox client */

test('a username resolves to a public account', async () => {
  const result = await resolveRobloxUsername('builderman', {
    fetchImpl: async (url, options) => {
      assert.match(url, /users\.roblox\.com\/v1\/usernames\/users$/);
      assert.equal(options.method, 'POST');
      return jsonResponse(200, { data: [{ id: 156, name: 'builderman', displayName: 'builderman' }] });
    },
  });
  assert.equal(result.found, true);
  assert.equal(result.userId, '156');
});

test('an unknown username is found:false, and a 429 is flagged unavailable', async () => {
  const missing = await resolveRobloxUsername('nobody_here', { fetchImpl: async () => jsonResponse(200, { data: [] }) });
  assert.equal(missing.found, false);
  assert.ok(!missing.unavailable);

  const limited = await resolveRobloxUsername('someone', { fetchImpl: async () => jsonResponse(429, {}) });
  assert.equal(limited.found, false);
  assert.equal(limited.unavailable, true);
});

test('an invalid username never reaches the network', async () => {
  let called = false;
  const result = await resolveRobloxUsername('../etc/passwd', {
    fetchImpl: async () => {
      called = true;
      return jsonResponse(200, { data: [] });
    },
  });
  assert.equal(result.found, false);
  assert.equal(result.invalid, true);
  assert.equal(called, false);
});

test('a Roblox profile read is best-effort about the avatar', async () => {
  const profile = await fetchRobloxProfile('156', {
    fetchImpl: async (url) => {
      if (url.includes('avatar-headshot')) return jsonResponse(200, { data: [{ state: 'Completed', imageUrl: 'https://img/1.png' }] });
      return jsonResponse(200, { id: 156, name: 'builderman', displayName: 'builderman', created: '2006-03-08T17:17:52.9Z' });
    },
  });
  assert.equal(profile.found, true);
  assert.equal(profile.avatarUrl, 'https://img/1.png');
  assert.equal(profile.username, 'builderman');
});

/* ------------------------------------------------------------ bot wiring */

test('the message handler dispatches the roblox family and keeps the gate', () => {
  const messages = source('bot/events/messageCreate.js');
  assert.match(messages, /isRobloxCommand/);
  assert.match(messages, /handleRobloxCommand/);
  assert.match(messages, /enforceRobloxGate/);
  // The profile command still exists and is untouched at its core.
  assert.match(messages, /isProfileCommand/);
});

test('the profile embed gains the Roblox field only through the opt-in path', () => {
  const messages = source('bot/events/messageCreate.js');
  assert.match(messages, /resolveRobloxProfileField/);
  assert.match(messages, /showOnProfiles/);
  assert.match(messages, /robloxField,/);
});

test('the join handler checks Bloxlink once and never on a schedule', () => {
  const join = source('bot/events/robloxJoin.js');
  assert.match(join, /lookupBloxlinkLink/);
  assert.match(join, /applyLinkResult/);
  // No interval/polling: the join check is event-driven.
  assert.ok(!/setInterval|setTimeout/.test(join), 'the join handler must not poll');
  assert.ok(!/guild\.members\.fetch\(\)/.test(join), 'the join handler must not enumerate members');
});

test('the events binder wires the Roblox join handler alongside the invite one', () => {
  const events = source('bot/events/index.js');
  assert.match(events, /createRobloxJoinHandler/);
  assert.match(events, /Events\.GuildMemberAdd/);
});

test('the bot process does not poll Bloxlink on its usage interval', () => {
  const index = source('bot/index.js');
  // The usage poll is about Neon; nothing in the bot shell may call Bloxlink.
  assert.ok(!/lookupBloxlinkLink|api\.blox\.link/.test(index), 'the bot shell must not touch Bloxlink');
});

/* ------------------------------------------------------- dashboard wiring */

test('the server mounts the Roblox router in both backends', () => {
  assert.match(source('api/admin/index.js'), /buildRobloxRouter/);
  assert.match(source('server/admin-routes.ts'), /buildRobloxRouter/);
});

test('the Roblox routes are owner/admin guarded', () => {
  const routes = source('api/_lib/roblox-routes.js');
  assert.match(routes, /requireRole\('admin'\)/);
  // The provider key is never returned to the browser; only a boolean is.
  assert.match(routes, /bloxlinkKeyConfigured/);
  assert.ok(!/BLOXLINK_API_KEY\s*:/.test(routes), 'the key value must not be returned');
});

test('the dashboard page and sidebar expose the Roblox section', () => {
  const app = source('client/src/AdminApp.tsx');
  assert.match(app, /pages\/admin-roblox/);
  assert.match(app, /path="\/roblox"/);
  assert.match(app, /permission="roblox"/);

  const sidebar = source('client/src/components/admin/admin-sidebar.tsx');
  assert.match(sidebar, /href="\/roblox"/);
  assert.match(sidebar, /canManageRoblox/);

  const auth = source('client/src/hooks/useAdminAuth.ts');
  assert.match(auth, /canManageRoblox/);
});

test('the dashboard page never renders an API key', () => {
  const page = source('client/src/pages/admin-roblox.tsx');
  assert.ok(!/apiKey|api_key|BLOXLINK_API_KEY/.test(page) || /never exposed here/.test(page));
  assert.ok(!/sk_|secret/.test(page), 'no secret is introduced in the page');
});

/* ------------------------------------------------------------ store wiring */

test('the cache table stores only the fields the requirement lists', () => {
  const store = source('api/_lib/roblox-store.js');
  for (const column of ['guild_id', 'discord_id', 'roblox_id', 'status', 'last_checked_at', 'linked_at']) {
    assert.ok(store.includes(column), `roblox_links carries ${column}`);
  }
  // No full Roblox payload is stored: the public profile is cached in-process.
  assert.ok(!/description text|avatar_url text/.test(store), 'no Roblox profile payload column');
});

test('a status change is the only thing that writes a log row', () => {
  const store = source('api/_lib/roblox-store.js');
  assert.match(store, /const changed =/);
  assert.match(store, /if \(changed\)/);
});

test('an outage preserves the last known link instead of overwriting it', () => {
  const store = source('api/_lib/roblox-store.js');
  // The unavailable path must not call upsertLink; it only touches the row.
  assert.match(store, /if \(unavailable && previous\)/);
  assert.match(store, /touchLinkCheck/);
  assert.match(store, /status: previous\.status/);
});
