/**
 * The profile command: the rename from `&dev`, the alias, the embed shape, the
 * link-status words and the invite attribution wiring.
 *
 * The pure helpers are exercised directly. The wiring is read from source, the
 * same approach `discord-bot.test.mjs` uses, because no gateway or database is
 * available to the runner.
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
  PROFILE_COMMAND,
  PROFILE_ALIASES,
  PROFILE_AUTHOR_ICON,
  isProfileCommand,
  linkStatus,
  linkStatusLabel,
  formatDate,
  humanizeAge,
  formatDateWithAge,
  relativeTimestamp,
  buildProfileEmbed,
} = await import('../bot/lib/bot-logic.js');

/* --------------------------------------------------------------- the rename */

test('profile is the primary command and pr is its only alias', () => {
  assert.equal(PROFILE_COMMAND, 'profile');
  assert.deepEqual(PROFILE_ALIASES, ['pr']);
  assert.equal(isProfileCommand('profile'), true);
  assert.equal(isProfileCommand('pr'), true);
});

test('the old dev command is no longer registered, under any alias', () => {
  assert.equal(isProfileCommand('dev'), false);
  // Nothing dispatches or defines a dev command any more.
  const logic = source('bot/lib/bot-logic.js');
  const messages = source('bot/events/messageCreate.js');
  assert.ok(!/'dev'/.test(messages), 'the handler does not dispatch a dev command');
  assert.ok(!/'dev'/.test(logic), 'the logic does not define a dev command');
});

/* --------------------------------------------------------- link status words */

test('link status keeps the three states apart', () => {
  assert.equal(linkStatus({ userById: { id: 'u' } }), 'linked');
  assert.equal(linkStatus({ userByEmail: { id: 'u' } }), 'not_linked');
  assert.equal(linkStatus({}), 'no_account');
  assert.equal(linkStatusLabel('linked'), 'Yes — linked');
  assert.equal(linkStatusLabel('not_linked'), 'Not linked');
  assert.equal(linkStatusLabel('no_account'), 'No account yet');
  // An unrecognised status falls back rather than rendering undefined.
  assert.equal(linkStatusLabel(undefined), 'No account yet');
});

/* ------------------------------------------------------------- date and age */

test('dates render as DD/MM/YYYY and ages are humanized', () => {
  assert.equal(formatDate(new Date('2024-03-14T12:00:00Z')), '14/03/2024');
  assert.equal(formatDate('not a date'), 'Unknown');
  assert.equal(humanizeAge(5_000), 'Just now');
  assert.equal(humanizeAge(10_000), '10 seconds ago');
  assert.equal(humanizeAge(120_000), '2 minutes ago');
  assert.equal(humanizeAge(3_600_000), '1 hour ago');
  assert.equal(humanizeAge(86_400_000), '1 day ago');
  assert.equal(humanizeAge(-1), 'Unknown');
});

test('an account-created line shows the date and the age', () => {
  const now = new Date('2026-03-14T00:00:00Z').getTime();
  assert.equal(formatDateWithAge(new Date('2024-03-14T00:00:00Z'), now), '14/03/2024 • 2 years ago');
  assert.equal(formatDateWithAge(null, now), 'Unknown');
});

test('the footer timestamp is a Discord relative timestamp', () => {
  const stamp = relativeTimestamp(new Date('2026-09-27T10:00:00Z'));
  assert.match(stamp, /^<t:\d+:R>$/);
  // An invalid input still renders a valid relative marker, never `NaN`.
  assert.match(relativeTimestamp('nope'), /<t:\d+:R>/);
});

/* ------------------------------------------------------------------ the embed */

test('the profile embed is one embed with the requested structure', () => {
  const now = new Date('2026-09-27T10:00:00Z').getTime();
  const embed = buildProfileEmbed({
    displayName: 'Alice',
    username: 'alice',
    avatarUrl: 'https://cdn.discordapp.com/avatars/1/a.png',
    role: 'owner',
    accountCreated: new Date('2024-03-14T00:00:00Z'),
    serverJoined: new Date('2025-06-22T00:00:00Z'),
    invitedBy: 'Bob',
    discordLinked: 'Yes — linked',
    requestedBy: 'alice',
    requestedAt: new Date('2026-09-27T10:00:00Z'),
    now,
    footerIconUrl: 'https://cdn.discordapp.com/avatars/1/a.png',
  });

  assert.equal(embed.title, '📋 Profile Information');
  assert.equal(typeof embed.color, 'number');
  // The static brand avatar, never the user's picture, is the author icon.
  assert.equal(embed.author.icon_url, PROFILE_AUTHOR_ICON);
  // The user's real avatar is the embed image, which sits above the fields.
  assert.equal(embed.image.url, 'https://cdn.discordapp.com/avatars/1/a.png');
  assert.equal(embed.footer.icon_url, 'https://cdn.discordapp.com/avatars/1/a.png');
  assert.match(embed.footer.text, /^Requested by alice • <t:\d+:R>$/);
  assert.match(embed.timestamp, /^2026-09-27T10:00:00/);

  assert.deepEqual(
    embed.fields.map((f) => f.name),
    [
      '👤 Name',
      '🏷️ Username',
      '🛡️ Role',
      '📅 Account Created',
      '📅 Server Joined',
      '🤝 Invited By',
      '🔗 Discord Linked',
    ],
  );
  assert.equal(embed.fields[0].value, 'Alice');
  assert.equal(embed.fields[1].value, '@alice');
  assert.equal(embed.fields[2].value, 'owner');
  assert.equal(embed.fields[3].value, '14/03/2024 • 2 years ago');
  assert.equal(embed.fields[4].value, '22/06/2025 • 1 year ago');
  assert.equal(embed.fields[5].value, 'Bob');
  assert.equal(embed.fields[6].value, 'Yes — linked');
});

test('the profile embed never renders undefined, null or NaN', () => {
  const embed = buildProfileEmbed({ requestedAt: new Date(), now: Date.now() });
  const flat = JSON.stringify(embed);
  assert.doesNotMatch(flat, /undefined|null|NaN/);
  // The documented fallbacks.
  assert.equal(embed.fields[2].value, 'No Role');
  assert.equal(embed.fields[5].value, 'Unknown');
  assert.equal(embed.fields[6].value, 'No account yet');
  // No avatar means no image block rather than an empty one.
  assert.equal(embed.image, undefined);
});

/* --------------------------------------------------------- invite tracking */

test('the member join handler attributes joins through the invite diff', () => {
  const handler = source('bot/events/guildMemberAdd.js');
  const events = source('bot/events/index.js');
  const store = source('bot/lib/bot-store.js');
  assert.match(handler, /guild\.invites\.fetch\(\)/, 'the invite list is fetched at join time');
  assert.match(handler, /recordInviteUse/, 'the used invite is recorded');
  assert.match(events, /Events\.GuildMemberAdd/, 'the event is wired');
  // The invite tables are created by the lazy schema step, not a migration.
  assert.match(store, /CREATE TABLE IF NOT EXISTS bot_invite_uses/);
  assert.match(store, /export async function getInviteJoin/);
  // A failed attribution must not throw into the gateway loop.
  assert.match(handler, /catch/);
});

/* --------------------------------------------------------------- activity */

test('the bot activity watches ProjectHub.inc', () => {
  const ready = source('bot/events/ready.js');
  assert.match(ready, /name: 'ProjectHub\.inc'/);
  assert.match(ready, /type: ActivityType\.Watching/);
});

/* ---------------------------------------------------------- command wiring */

test('message and command handling lives in messageCreate.js', () => {
  const messages = source('bot/events/messageCreate.js');
  const bot = source('bot/index.js');
  // The command surface moved out of the process shell.
  assert.match(messages, /export async function handleMessage/);
  assert.match(messages, /export async function handleProfile/);
  assert.match(messages, /export function createMessageCreateHandler/);
  assert.ok(!/export async function handleMessage/.test(bot), 'index.js no longer holds command handling');
  // The role comes from the admin credential, else member.
  assert.match(messages, /identity\.admin\?\.role \|\| 'member'/);
  // The only database reads are the three Discord cannot answer.
  assert.match(messages, /getProfileIdentity/, 'site role and link status');
  assert.match(messages, /getInviteJoin/, 'invite attribution');
  // Display name, username and the avatar come from the gateway objects.
  assert.match(messages, /displayAvatarURL/, 'the real Discord avatar is used');
});
