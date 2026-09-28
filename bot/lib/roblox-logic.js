/**
 * Pure Roblox / Bloxlink formatting and command logic.
 *
 * Nothing here imports discord.js, a database driver or `process.env`. The bot
 * process decorates these results with live Discord objects and the dashboard
 * renders the same rules, so the status vocabulary, the input validation and the
 * embed shapes can be checked without a gateway connection or a database.
 *
 * ## Bloxlink is the source of truth, and only Bloxlink
 *
 * The rule this module exists to keep: a Discord username that happens to equal
 * a Roblox username is **not** evidence of anything. The only value that ever
 * becomes `LINKED` is a Roblox account id returned by Bloxlink's own API for
 * that Discord id. Bloxlink's linking process proves ownership of the Roblox
 * account, so a link is reported as `Bloxlink Verified`; anything the API did
 * not confirm stays `Not Linked`.
 *
 * The four statuses mirror what the public API can actually answer:
 *
 *   - `linked`                 — Bloxlink returned a Roblox account id.
 *   - `not_linked`             — Bloxlink answered, and there is no account.
 *   - `verification_unavailable` — we could not ask (no API key, guild not
 *                                configured, quota exhausted). Not the same as
 *                                "not linked", and never rendered as such.
 *   - `bloxlink_unavailable`   — the API could not be reached.
 */
import { formatDateWithAge, relativeTimestamp } from './bot-logic.js';

/** The `&roblox` command family. */
export const ROBLOX_COMMAND = 'roblox';
export const ROBLOX_SUBCOMMANDS = ['profile', 'lookup', 'verify', 'unlink', 'status'];

/** The color of the Roblox embeds, matching the bot's indigo theme. */
export const ROBLOX_COLOR = 0x6366f1;

/** A Roblox account id is a decimal snowflake-like number. */
export function isValidRobloxId(value) {
  return /^\d{1,20}$/.test(String(value ?? '').trim());
}

/**
 * A plausible Roblox username: 3-20 characters of letters, digits or underscore.
 *
 * Roblox usernames are restricted to `[A-Za-z0-9_]`; this rejects the shapes
 * that would otherwise be interpolated into a URL, so a lookup cannot be turned
 * into a request for a different resource.
 */
export function isValidRobloxUsername(value) {
  return /^[A-Za-z0-9_]{3,20}$/.test(String(value ?? '').trim());
}

/** The canonical public profile URL for an account id. */
export function robloxProfileUrl(userId) {
  return isValidRobloxId(userId) ? `https://www.roblox.com/users/${userId}/profile` : null;
}

/* --------------------------------------------------------------- statuses */

export const ROBLOX_STATUS = {
  NOT_LINKED: 'not_linked',
  LINKED: 'linked',
  VERIFICATION_UNAVAILABLE: 'verification_unavailable',
  BLOXLINK_UNAVAILABLE: 'bloxlink_unavailable',
};

/** The user-facing status word, exactly as the requirements list them. */
export function robloxStatusLabel(status) {
  switch (status) {
    case ROBLOX_STATUS.LINKED:
      return 'Linked';
    case ROBLOX_STATUS.VERIFICATION_UNAVAILABLE:
      return 'Verification unavailable';
    case ROBLOX_STATUS.BLOXLINK_UNAVAILABLE:
      return 'Bloxlink unavailable';
    case ROBLOX_STATUS.NOT_LINKED:
    default:
      return 'Not Linked';
  }
}

/** `✓ Linked` / `○ Not Linked` / the two unavailable states, for a field value. */
export function robloxStatusField(status) {
  switch (status) {
    case ROBLOX_STATUS.LINKED:
      return '✓ Linked';
    case ROBLOX_STATUS.VERIFICATION_UNAVAILABLE:
      return '⚠ Verification unavailable';
    case ROBLOX_STATUS.BLOXLINK_UNAVAILABLE:
      return '⚠ Bloxlink unavailable';
    case ROBLOX_STATUS.NOT_LINKED:
    default:
      return '○ Not Linked';
  }
}

/** Whether a status means Bloxlink confirmed a linked Roblox account. */
export function isLinkedStatus(status) {
  return status === ROBLOX_STATUS.LINKED;
}

/**
 * The compact Roblox field added to the existing ProjectHub profile embed.
 *
 * Only produced for a confirmed link, so an unlinked member's profile is
 * byte-for-byte what it was before this feature existed. Format matches the
 * requirement's example: the Roblox username on one line and `✓ Bloxlink
 * Verified` on the next.
 */
export function robloxProfileField({
  robloxUsername,
  robloxDisplayName = null,
  robloxUserId = null,
  status = ROBLOX_STATUS.LINKED,
  rank = null,
  mode = 'compact',
} = {}) {
  if (!isLinkedStatus(normalizeStatus(status))) return null;
  const name = robloxUsername || robloxDisplayName;
  if (!name) return null;
  const lines = [`\`${name}\``, '✓ Bloxlink Verified'];
  // `full` adds the id the link actually resolved to; `compact` stays one line.
  if (mode === 'full' && isValidRobloxId(robloxUserId)) lines.push(`🆔 ${robloxUserId}`);
  if (rank) lines.push(`Rank: ${rank}`);
  return { name: '🎮 Roblox', value: lines.join('\n'), inline: false };
}

/**
 * Coerces whatever the client returned into one of the four statuses.
 *
 * The client never throws into the renderer: it resolves an `{ status, ... }`
 * envelope, and anything unrecognised is treated as "we could not verify"
 * rather than "not linked", so a failure never silently reads as an unlinked
 * account.
 */
export function normalizeStatus(value) {
  return Object.values(ROBLOX_STATUS).includes(value) ? value : ROBLOX_STATUS.VERIFICATION_UNAVAILABLE;
}

/* ------------------------------------------------------------- command args */

/** Whether a parsed command is the `roblox` family. */
export function isRobloxCommand(command) {
  return command === ROBLOX_COMMAND;
}

/**
 * Parses the subcommand of `&roblox <sub> [arg]`.
 *
 * A bare `&roblox` is the same as `&roblox profile`. An unknown subcommand is
 * reported so the caller can answer with the usage instead of silently guessing.
 */
export function parseRobloxSubcommand(args = []) {
  const [raw, ...rest] = args;
  if (!raw) return { subcommand: 'profile', args: rest, unknown: null };
  const sub = String(raw).toLowerCase();
  if (!ROBLOX_SUBCOMMANDS.includes(sub)) return { subcommand: null, args: [], unknown: sub };
  return { subcommand: sub, args: rest, unknown: null };
}

/**
 * Extracts a Discord id from a raw command argument.
 *
 * Accepts a raw snowflake or a `<@id>`/`<@!id>` mention, and rejects anything
 * that is not a plausible snowflake, so a member id can never be half-parsed
 * out of arbitrary text.
 */
export function discordIdFromArg(value) {
  const text = String(value ?? '').trim();
  const mention = text.match(/^<@!?(\d{15,25})>$/);
  if (mention) return mention[1];
  return /^\d{15,25}$/.test(text) ? text : null;
}

/* -------------------------------------------------------------- embed data */

/**
 * The Roblox profile embed for a linked member.
 *
 * Built as a plain object rather than a discord.js `EmbedBuilder`, matching
 * `buildProfileEmbed`, so the tests can assert the field values directly and no
 * field can render `undefined`, `null` or `NaN`.
 *
 * The avatar is the embed image so Discord renders it above the field list,
 * mirroring the existing ProjectHub profile embed's layout.
 */
export function buildRobloxProfileEmbed({
  discordName,
  robloxUsername,
  robloxDisplayName = null,
  robloxUserId,
  avatarUrl = null,
  accountCreated = null,
  status = ROBLOX_STATUS.LINKED,
  rank = null,
  requestedBy = 'unknown',
  requestedAt = new Date(),
  now = Date.now(),
  footerIconUrl = null,
} = {}) {
  const url = robloxProfileUrl(robloxUserId);
  const fields = [
    { name: '🎮 Roblox', value: robloxUsername ? `\`${robloxUsername}\`` : 'Unknown', inline: true },
    { name: '📛 Display Name', value: robloxDisplayName || robloxUsername || 'Unknown', inline: true },
    { name: '🆔 User ID', value: robloxUserId ? String(robloxUserId) : 'Unknown', inline: true },
    { name: '📅 Account Created', value: formatDateWithAge(accountCreated, now), inline: true },
    { name: '🔗 Bloxlink', value: robloxStatusField(status), inline: true },
  ];
  if (url) fields.push({ name: '🌐 Profile', value: `[View on Roblox](${url})`, inline: true });
  if (rank) fields.push({ name: '🎖️ Roblox Rank', value: String(rank), inline: false });

  return {
    title: '🎮 Roblox Profile',
    color: ROBLOX_COLOR,
    description: `**Discord**\n${discordName || 'Unknown'}`,
    ...(avatarUrl ? { thumbnail: { url: avatarUrl } } : {}),
    fields,
    footer: {
      text: `Requested by ${requestedBy} • ${relativeTimestamp(requestedAt)}`,
      ...(footerIconUrl ? { icon_url: footerIconUrl } : {}),
    },
    timestamp: new Date(requestedAt).toISOString(),
  };
}

/** The reply for a member Bloxlink has no linked account for. */
export function buildRobloxUnlinkedEmbed({
  discordName,
  status = ROBLOX_STATUS.NOT_LINKED,
  requestedBy = 'unknown',
  requestedAt = new Date(),
} = {}) {
  const unavailable = normalizeStatus(status) !== ROBLOX_STATUS.NOT_LINKED;
  return {
    title: '🎮 Roblox Profile',
    color: ROBLOX_COLOR,
    description: unavailable
      ? `I could not check Bloxlink for ${discordName || 'that member'} right now.\n` +
        'That is not a "not linked" answer — try again shortly.'
      : `${discordName || 'That member'} has not linked a Roblox account through Bloxlink.\n\n` +
        'They can link one with `/roblox verify`. Usernames alone are never treated as proof of ownership.',
    fields: [{ name: '🔗 Bloxlink', value: robloxStatusField(status), inline: true }],
    footer: { text: `Requested by ${requestedBy} • ${relativeTimestamp(requestedAt)}` },
    timestamp: new Date(requestedAt).toISOString(),
  };
}

/**
 * The public Roblox lookup embed.
 *
 * Deliberately separate from the Bloxlink profile embed and labelled as a
 * public lookup: resolving a username is not a statement about which Discord
 * account owns it, and the embed says so.
 */
export function buildRobloxLookupEmbed({
  robloxUsername,
  robloxDisplayName = null,
  robloxUserId,
  avatarUrl = null,
  accountCreated = null,
  requestedBy = 'unknown',
  requestedAt = new Date(),
  now = Date.now(),
} = {}) {
  const url = robloxProfileUrl(robloxUserId);
  return {
    title: '🔎 Roblox Lookup',
    color: ROBLOX_COLOR,
    description: 'Public Roblox account information. This does not link the account to Discord.',
    ...(avatarUrl ? { thumbnail: { url: avatarUrl } } : {}),
    fields: [
      { name: '🎮 Username', value: robloxUsername ? `\`${robloxUsername}\`` : 'Unknown', inline: true },
      { name: '📛 Display Name', value: robloxDisplayName || robloxUsername || 'Unknown', inline: true },
      { name: '🆔 User ID', value: robloxUserId ? String(robloxUserId) : 'Unknown', inline: true },
      { name: '📅 Account Created', value: formatDateWithAge(accountCreated, now), inline: false },
      ...(url ? [{ name: '🌐 Profile', value: `[View on Roblox](${url})`, inline: false }] : []),
    ],
    footer: { text: `Requested by ${requestedBy} • ${relativeTimestamp(requestedAt)}` },
    timestamp: new Date(requestedAt).toISOString(),
  };
}

/** The reply for a username the Roblox API does not know. */
export function buildRobloxLookupMissingEmbed({ username, requestedBy = 'unknown', requestedAt = new Date() } = {}) {
  return {
    title: '🔎 Roblox Lookup',
    color: ROBLOX_COLOR,
    description: `No Roblox account named \`${String(username ?? '').slice(0, 40)}\` was found.`,
    footer: { text: `Requested by ${requestedBy} • ${relativeTimestamp(requestedAt)}` },
    timestamp: new Date(requestedAt).toISOString(),
  };
}

/**
 * The `/roblox verify` reply.
 *
 * The bot does not implement verification: it points the member at Bloxlink,
 * which owns that process. The wording changes with the current state so a
 * linked member is told they are already done rather than being sent through the
 * flow again.
 */
export function buildRobloxVerifyEmbed({
  discordName,
  status,
  verifyInstructions = null,
  requestedBy = 'unknown',
  requestedAt = new Date(),
} = {}) {
  const normalized = normalizeStatus(status);
  const steps =
    verifyInstructions ||
    '**How to verify**\n' +
      '1. Open Bloxlink and run its verify command in this server (or use Bloxlink’s dashboard).\n' +
      '2. Choose **verify by code** or **verify by game** and follow Bloxlink’s prompts.\n' +
      '3. Come back and run `/roblox profile` — I read the result from Bloxlink automatically.';

  let description;
  if (normalized === ROBLOX_STATUS.LINKED) {
    description = `${discordName || 'You'} already has a Roblox account linked through Bloxlink. Nothing to do.`;
  } else if (normalized === ROBLOX_STATUS.NOT_LINKED) {
    description = `Bloxlink has no Roblox account linked for ${discordName || 'you'} yet.\n\n${steps}`;
  } else {
    description =
      'I could not reach Bloxlink to check your link status just now. ' +
      'You can still start verification from Bloxlink; I will pick the result up once it is reachable again.';
  }

  return {
    title: '🎮 Bloxlink Verification',
    color: ROBLOX_COLOR,
    description,
    fields: [{ name: '🔗 Status', value: robloxStatusField(normalized), inline: true }],
    footer: { text: `Requested by ${requestedBy} • ${relativeTimestamp(requestedAt)}` },
    timestamp: new Date(requestedAt).toISOString(),
  };
}

/**
 * The `/roblox unlink` reply.
 *
 * Unlinking is Bloxlink's action, not the bot's: a private server cannot detach
 * an account that Bloxlink owns, and pretending otherwise would desynchronise
 * the two. The bot therefore directs the member to Bloxlink.
 */
export function buildRobloxUnlinkEmbed({ requestedBy = 'unknown', requestedAt = new Date() } = {}) {
  return {
    title: '🔗 Unlink Roblox account',
    color: ROBLOX_COLOR,
    description:
      'Roblox accounts are linked and unlinked through Bloxlink, not through this bot. ' +
      'Run Bloxlink’s unlink command in this server (or use the Bloxlink dashboard) to detach the account; ' +
      'the bot will reflect the change on the next lookup.',
    footer: { text: `Requested by ${requestedBy} • ${relativeTimestamp(requestedAt)}` },
    timestamp: new Date(requestedAt).toISOString(),
  };
}

/** The reply when a Roblox-only or Bloxlink-only subcommand is used wrongly. */
export function buildRobloxUsageEmbed({ prefix = '&' } = {}) {
  return {
    title: '🎮 Roblox commands',
    color: ROBLOX_COLOR,
    description:
      `\`${prefix}roblox profile [member]\` — Roblox account linked through Bloxlink.\n` +
      `\`${prefix}roblox lookup <username>\` — public Roblox lookup (does not link).\n` +
      `\`${prefix}roblox verify\` — how to verify with Bloxlink.\n` +
      `\`${prefix}roblox unlink\` — how to unlink through Bloxlink.\n` +
      `\`${prefix}roblox status [member]\` — short Bloxlink status line.`,
  };
}
