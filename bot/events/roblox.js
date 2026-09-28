/**
 * Roblox commands and feature gating for the private server bot.
 *
 * This module is the glue between the Discord message/join events and the
 * shared Roblox service. The pure formatting lives in `bot/lib/roblox-logic.js`
 * and the cache/provider work in `api/_lib/roblox-*`, so everything here is the
 * part that touches live Discord objects.
 *
 * The commands are:
 *
 *   `&roblox profile [member]` — the member's Roblox account, read from Bloxlink.
 *   `&roblox lookup <username>` — a public Roblox lookup, unconnected to Discord.
 *   `&roblox verify`           — the steps to verify with Bloxlink.
 *   `&roblox unlink`           — how to unlink through Bloxlink.
 *   `&roblox status [member]`  — a compact status line.
 *
 * The bot never invents a link and never implements verification: Bloxlink owns
 * that, and every answer here is whatever Bloxlink returned.
 */
import {
  ROBLOX_STATUS,
  isRobloxCommand,
  parseRobloxSubcommand,
  discordIdFromArg,
  buildRobloxProfileEmbed,
  buildRobloxUnlinkedEmbed,
  buildRobloxLookupEmbed,
  buildRobloxLookupMissingEmbed,
  buildRobloxVerifyEmbed,
  buildRobloxUnlinkEmbed,
  buildRobloxUsageEmbed,
  robloxStatusField,
  robloxStatusLabel,
  isValidRobloxUsername,
} from '../lib/roblox-logic.js';
import {
  getMemberRoblox,
  getRobloxProfile,
  isVerifiedOnlyChannel,
  evaluateFeatureAccess,
  featureAccessMessage,
} from '../../api/_lib/roblox-service.js';
import { getRobloxSettings } from '../../api/_lib/roblox-store.js';
import { resolveRobloxUsername } from '../../api/_lib/roblox-client.js';

/** Commands a verified-only gate never blocks, so a member can always link. */
const GATE_EXEMPT_COMMANDS = new Set(['roblox', 'help']);

/**
 * Whether the member's Roblox link is required for this message, and if so
 * whether it is satisfied.
 *
 * Reads the cached settings and the member's cached Bloxlink status. The check
 * is cache-first, so a restricted channel does not spend a Bloxlink call per
 * message; a member who just linked is picked up when the cache next refreshes
 * or when they run `/roblox profile`. Staff always pass, so an administrator is
 * never locked out by an outage.
 *
 * Returns `{ blocked, reply }`; `blocked: false` means the message may proceed.
 */
export async function enforceRobloxGate(message, { isStaff = false, fetchImpl = fetch, prefix = '&' } = {}) {
  try {
    const settings = await getRobloxSettings();
    if (!settings.enabled || !settings.requireVerification) return { blocked: false };

    const parsed = shallowCommand(message.content, prefix);
    if (parsed && GATE_EXEMPT_COMMANDS.has(parsed)) return { blocked: false };

    const guildId = message.guild?.id || '';
    const channelGated = isVerifiedOnlyChannel(settings, message.channel?.id);
    // Two ways a feature can be gated: the channel is listed, or (with no list
    // configured) every command is gated. The second is what "verified-only
    // commands" means when an operator has not named channels.
    const commandGated = !settings.verifiedOnlyChannels;
    if (!channelGated && !commandGated) return { blocked: false };

    const result = await getMemberRoblox({ guildId, discordId: message.author?.id, fetchImpl });
    const access = evaluateFeatureAccess({ settings, status: result.status, isStaff });
    if (access.allowed) return { blocked: false, result };

    return { blocked: true, reply: featureAccessMessage(access.reason, { prefix }), result };
  } catch (error) {
    // A gate that cannot read its configuration must not lock everyone out.
    console.error('[bot] roblox gate check failed:', error.message);
    return { blocked: false };
  }
}

/** The lower-cased command token of a message, or null when it has none. */
function shallowCommand(content, prefix = '&') {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text.startsWith(prefix)) return null;
  const token = text.slice(prefix.length).trim().split(/\s+/)[0];
  return token ? token.toLowerCase() : null;
}

/**
 * `&roblox ...` — every Roblox subcommand.
 *
 * `message` supplies the requester and the guild; the optional `member` argument
 * is resolved by the caller and passed in as `target`, so this stays a pure
 * formatter over the service result.
 */
export async function handleRobloxCommand(message, parsed, { target = null, fetchImpl = fetch, logCommand = null, prefix = '&' } = {}) {
  const { subcommand, args, unknown } = parseRobloxSubcommand(parsed.args || []);
  const settings = await getRobloxSettings().catch(() => null);
  const guildId = message.guild?.id || '';
  const requestedBy = message.author?.username || 'unknown';

  if (!subcommand) return message.reply({ embeds: [buildRobloxUsageEmbed({ prefix })] });
  if (unknown && !['help', 'commands'].includes(unknown)) {
    return message.reply({ embeds: [buildRobloxUsageEmbed({ prefix })] });
  }

  const member = target || message.member || message.author;
  const user = member?.user || message.author;
  const displayName = member?.displayName || user?.globalName || user?.username || 'Unknown';

  logCommand?.('roblox %s for %s', subcommand, user?.id);

  if (subcommand === 'lookup') return handleLookup(message, args, { fetchImpl, requestedBy });
  if (subcommand === 'verify') return handleVerify(message, { guildId, user, displayName, settings, fetchImpl, requestedBy });
  if (subcommand === 'unlink') return message.reply({ embeds: [buildRobloxUnlinkEmbed({ requestedBy })] });
  if (subcommand === 'status') return handleStatus(message, { guildId, user, displayName, fetchImpl, requestedBy });

  // profile
  return handleProfile(message, { guildId, user, displayName, settings, fetchImpl, requestedBy });
}

/** `&roblox profile [member]` — the linked Roblox account, or an explanation. */
async function handleProfile(message, { guildId, user, displayName, settings, fetchImpl, requestedBy }) {
  if (!user?.id) return undefined;

  const result = await getMemberRoblox({ guildId, discordId: user.id, fetchImpl });
  const avatar = user.displayAvatarURL?.({ size: 256, extension: 'png' }) || null;

  if (result.status !== ROBLOX_STATUS.LINKED) {
    return message.reply({
      embeds: [
        buildRobloxUnlinkedEmbed({
          discordName: displayName,
          status: result.status,
          requestedBy,
        }),
      ],
    });
  }

  const profile = result.profile;
  return message.reply({
    embeds: [
      buildRobloxProfileEmbed({
        discordName: displayName,
        robloxUsername: profile?.username || `user ${result.robloxId}`,
        robloxDisplayName: profile?.displayName || null,
        robloxUserId: result.robloxId,
        avatarUrl: avatar,
        accountCreated: profile?.created || null,
        status: result.status,
        requestedBy,
        footerIconUrl: message.author?.displayAvatarURL?.({ size: 64, extension: 'png' }) || null,
      }),
    ],
  });
}

/** `&roblox status [member]` — a compact status line. */
async function handleStatus(message, { guildId, user, displayName, fetchImpl, requestedBy }) {
  if (!user?.id) return undefined;
  const result = await getMemberRoblox({ guildId, discordId: user.id, fetchImpl });
  const profile = result.profile;
  const lines = [
    `**${displayName}**`,
    `🔗 Bloxlink: ${robloxStatusField(result.status)}`,
  ];
  if (profile?.username) lines.push(`🎮 Roblox: \`${profile.username}\``);
  if (result.robloxId) lines.push(`🆔 User ID: ${result.robloxId}`);
  lines.push(result.cached ? '_cached_' : '_checked just now_');

  return message.reply({
    embeds: [
      {
        title: '🎮 Roblox Status',
        color: 0x6366f1,
        description: lines.join('\n'),
        footer: { text: `Requested by ${requestedBy}` },
      },
    ],
  });
}

/** `&roblox verify` — point the member at Bloxlink's own verification flow. */
async function handleVerify(message, { guildId, user, displayName, settings, fetchImpl, requestedBy }) {
  if (!user?.id) return undefined;
  const result = await getMemberRoblox({ guildId, discordId: user.id, fetchImpl });
  return message.reply({
    embeds: [
      buildRobloxVerifyEmbed({
        discordName: displayName,
        status: result.status,
        verifyInstructions: settings?.verificationChannelId
          ? `Head to <#${settings.verificationChannelId}> and follow the verification steps there.\n\n` +
            '1. Run Bloxlink’s verify command (or open Bloxlink’s dashboard).\n' +
            '2. Verify by code or by game, following Bloxlink’s prompts.\n' +
            '3. Run `/roblox profile` — I read the result from Bloxlink automatically.'
          : null,
        requestedBy,
      }),
    ],
  });
}

/** `&roblox lookup <username>` — a public Roblox lookup, never a link. */
async function handleLookup(message, args, { fetchImpl, requestedBy }) {
  const username = (args || []).join(' ').trim();
  if (!username || !isValidRobloxUsername(username)) {
    return message.reply({
      embeds: [
        {
          title: '🔎 Roblox Lookup',
          color: 0x6366f1,
          description: 'Usage: `&roblox lookup <username>` — a Roblox username (3-20 letters, digits or underscores).',
        },
      ],
    });
  }

  const resolved = await resolveRobloxUsername(username, { fetchImpl });
  if (!resolved.found) {
    return message.reply({
      embeds: [
        buildRobloxLookupMissingEmbed({
          username: resolved.unavailable ? `${username} (Roblox API unavailable)` : username,
          requestedBy,
        }),
      ],
    });
  }

  // A second read for the profile fields; a failure there only costs the avatar
  // and creation date, so the lookup still answers with the id and username.
  const profile = await getRobloxProfile(resolved.userId, { fetchImpl }).catch(() => null);

  return message.reply({
    embeds: [
      buildRobloxLookupEmbed({
        robloxUsername: resolved.username,
        robloxDisplayName: resolved.displayName,
        robloxUserId: resolved.userId,
        avatarUrl: profile?.avatarUrl || null,
        accountCreated: profile?.created || null,
        requestedBy,
      }),
    ],
  });
}

/* ------------------------------------------------------------ notifications */

/**
 * Posts a link-change notification when one is configured.
 *
 * Called only when the service reports an actual transition, so a stable link
 * posts nothing. A delivery failure is logged and swallowed: a notification is a
 * side effect and must never fail the command that produced it.
 */
export async function notifyLinkChange(client, settings, { eventType, discordId, robloxId = null, detail = null } = {}) {
  if (!settings?.notifyOnLink || !settings?.notifyChannelId || !eventType) return false;
  const titles = {
    linked: 'Roblox account linked',
    unlinked: 'Roblox account unlinked',
    status_change: 'Roblox verification status changed',
    bloxlink_failure: 'Bloxlink integration error',
  };
  const title = titles[eventType];
  if (!title) return false;

  try {
    const channel = await client.channels.fetch(settings.notifyChannelId);
    if (!channel?.isTextBased?.()) return false;
    await channel.send({
      embeds: [
        {
          title: `🎮 ${title}`,
          color: eventType === 'bloxlink_failure' ? 0xef4444 : 0x6366f1,
          description:
            `<@${discordId}>` +
            (robloxId ? `\nRoblox ID: ${robloxId}` : '') +
            (detail ? `\nStatus: ${robloxStatusLabel(detail)}` : ''),
          timestamp: new Date().toISOString(),
        },
      ],
      // A notification must never ping the channel.
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (error) {
    console.error('[bot] roblox notification failed:', error.message);
    return false;
  }
}

export { isRobloxCommand };
