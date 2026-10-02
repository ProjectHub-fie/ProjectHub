import { BOT_PREFIX, parseCommand, isProfileCommand, PROFILE_COMMAND, PROFILE_ALIASES, resolveRoles, buildProfileEmbed, discordLinkedLabel } from '../lib/bot-logic.js';
import { isRobloxCommand, robloxProfileField } from '../lib/roblox-logic.js';
import { getProfileIdentity, getInviteJoin } from '../lib/bot-store.js';
import { handleRobloxCommand, enforceRobloxGate } from './roblox.js';
import { getRobloxSettings } from '../lib/roblox-store.js';
import { getMemberRoblox } from '../lib/roblox-service.js';

/**
 * Message and command handling for the ProjectHub bot.
 *
 * Everything that turns a message into a reply lives here, so `bot/index.js` is
 * only the process shell (gateway, heartbeat, usage poll). The pure command
 * parsing and embed shapes stay in `bot/lib/bot-logic.js`; this module is the
 * glue that reads the live message/member/user objects and the few database
 * rows the profile actually needs.
 *
 * The only database reads are the ones Discord cannot answer: the site role,
 * the Discord link status, and the invite attribution. Display name, username,
 * avatar and both timestamps come from the member/user objects the gateway
 * already delivered.
 */
export function createMessageCreateHandler({ getConfig, logMessage = null, logCommand = null }) {
  return (message) => {
    handleMessage(message, { getConfig, logMessage, logCommand }).catch((error) =>
      console.error('[bot] message handling failed:', error),
    );
  };
}

/**
 * Routes one message: a mention first, then a prefix command.
 *
 * The mention path exists because members treat an @ as "talk to the bot" and
 * should not have to remember the prefix. It answers the same profile question
 * when the mention carries no command, so `@ProjectHub` and `@ProjectHub pr`
 * both work.
 */
export async function handleMessage(message, { getConfig, logMessage = null, logCommand = null } = {}) {
  if (!message || message.author?.bot) return undefined;

  const config = (await getConfig?.()) || { prefix: BOT_PREFIX };
  const mentioned = message.mentions?.has?.(message.client?.user?.id);

  logMessage?.(
    '%s from %s in %s: %s',
    mentioned ? 'mention' : 'message',
    message.author?.tag || message.author?.id,
    message.guild ? message.guild.name : 'DM',
    message.content,
  );

  if (mentioned) {
    // Strip the mention so the remainder parses like a prefixed command.
    const stripped = message.content.replace(/<@!?\d+>/g, '').trim();
    const parsed = parseCommand(stripped, '') || { command: PROFILE_COMMAND, args: [], rest: '' };
    return runCommand(parsed, message, config, { via: 'mention', logCommand });
  }

  const parsed = parseCommand(message.content, config.prefix || BOT_PREFIX);
  if (!parsed) return undefined;
  return runCommand(parsed, message, config, { via: 'prefix', logCommand });
}

async function runCommand(parsed, message, config, { via, logCommand = null }) {
  logCommand?.('%s via %s from %s', parsed.command, via, message.author?.tag || message.author?.id);
  // Every alias resolves to the profile command through one branch.
  if (isProfileCommand(parsed.command)) {
    return handleProfile(message, { via, logCommand });
  }

  if (isRobloxCommand(parsed.command)) {
    // The Roblox family is where the verified-only gate applies. It reads the
    // cached status, so a restricted channel costs a database read, not a
    // Bloxlink call per message; the commands that let a member link are exempt.
    const prefix = config.prefix || BOT_PREFIX;
    const staff = await isStaffMember(message);
    const gate = await enforceRobloxGate(message, { isStaff: staff, prefix });
    if (gate.blocked) return message.reply(gate.reply);
    const target = await resolveTargetMember(message);
    return handleRobloxCommand(message, parsed, { target, logCommand, prefix });
  }

  // The gate also covers every other command when the operator has not named
  // specific channels: "verified-only commands" is the default reading of
  // `requireVerification` with no channel list.
  const staff = await isStaffMember(message);
  const gate = await enforceRobloxGate(message, { isStaff: staff, prefix: config.prefix || BOT_PREFIX });
  if (gate.blocked) return message.reply(gate.reply);

  switch (parsed.command) {
    case 'help':
      return message.reply(
        'ProjectHub commands:\n' +
          `\`${config.prefix || BOT_PREFIX}${PROFILE_COMMAND}\` — your ProjectHub profile.\n` +
          `Alias: \`${config.prefix || BOT_PREFIX}${PROFILE_ALIASES[0]}\`.\n` +
          `\`${config.prefix || BOT_PREFIX}roblox profile|lookup|verify|unlink|status\` — Roblox via Bloxlink.\n` +
          'You can also just @ me.',
      );
    default:
      // An unknown command is answered only when the bot was addressed directly;
      // otherwise ordinary chatter containing the prefix would get a reply.
      if (via === 'mention') {
        return message.reply(`I don't know \`${parsed.command}\`. Try \`${config.prefix || BOT_PREFIX}help\`.`);
      }
      return undefined;
  }
}

/**
 * The member a Roblox command targets: the first mention, else the author.
 *
 * Discord's own member objects are used rather than a REST fetch, so an
 * uncached member is not an extra request; the author is always resolvable.
 */
async function resolveTargetMember(message) {
  const mentioned = message.mentions?.members?.first?.();
  if (mentioned) return mentioned;
  return message.member || message.guild?.members?.cache?.get(message.author?.id) || message.author;
}

/** Whether the author holds an admin/owner role in the site tables. */
async function isStaffMember(message) {
  try {
    const identity = await getProfileIdentity(message.author?.id);
    return Boolean(identity.admin?.role);
  } catch {
    return false;
  }
}

/**
 * `&profile` / `&pr` — shows the ProjectHub profile of the person asking, or of
 * the member mentioned.
 *
 * The reply is a single embed. The avatar is placed as the embed image so it
 * renders above the field list, and the footer names the requester with a
 * Discord relative timestamp that each reader sees localized.
 */
export async function handleProfile(message, { via, logCommand = null } = {}) {
  const guild = message.guild;
  const mentionedMember = message.mentions?.members?.first?.() || null;
  const target = mentionedMember || guild?.members?.cache?.get(message.author?.id) || message.member || message.author;
  const targetUser = target?.user || message.author;
  if (!targetUser?.id) return undefined;

  let identity;
  try {
    identity = await getProfileIdentity(targetUser.id);
  } catch (error) {
    console.error('[bot] profile lookup failed:', error.message);
    return message.reply('I could not reach the ProjectHub database just now. Try again shortly.');
  }

  const resolved = resolveRoles(identity);
  // The site role: the admin credential's role when the id is found there,
  // otherwise `member`. `No Role` remains the embed's defensive fallback for a
  // value that never resolved, so a role is never invented.
  const roleName = identity.admin?.role || 'member';

  let invitedBy = 'Unknown';
  try {
    if (guild) {
      const join = await getInviteJoin(guild.id, targetUser.id);
      invitedBy = (await resolveInviterName(guild, join)) || 'Unknown';
    }
  } catch (error) {
    console.error('[bot] invite lookup failed:', error.message);
  }

  const displayName = target?.displayName || targetUser.globalName || targetUser.username || 'Unknown';
  const username = targetUser.username || 'unknown';
  const avatarUrl = targetUser.displayAvatarURL?.({ size: 256, extension: 'png' }) || null;

  // Roblox is opt-in and only added when the integration is enabled, the
  // "show on profiles" switch is on, and Bloxlink confirms a link. The lookup is
  // the cached one, so opening a profile does not spend a Bloxlink call.
  const robloxField = await resolveRobloxProfileField(guild?.id, targetUser.id);

  logCommand?.(
    '%s for %s resolved: linked=%s admin=%s roles=%o',
    PROFILE_COMMAND,
    targetUser.id,
    resolved.isLinked,
    resolved.isAdmin,
    resolved.roles,
  );

  const embed = buildProfileEmbed({
    displayName,
    username,
    avatarUrl,
    role: roleName,
    accountCreated: targetUser.createdAt || (targetUser.createdTimestamp ? new Date(targetUser.createdTimestamp) : null),
    serverJoined: target?.joinedAt || (target?.joinedTimestamp ? new Date(target.joinedTimestamp) : null),
    invitedBy,
    discordLinked: discordLinkedLabel(identity.linked),
    robloxField,
    requestedBy: message.author?.username || 'unknown',
    requestedAt: new Date(),
    footerIconUrl: message.author?.displayAvatarURL?.({ size: 64, extension: 'png' }) || null,
  });

  return message.reply({ embeds: [embed] });
}

/**
 * The Roblox field for the `&profile` embed, or `null`.
 *
 * Best-effort by design: a Roblox or database failure must leave the existing
 * profile exactly as it was, so this swallows its own errors and returns null
 * rather than failing the profile command.
 */
async function resolveRobloxProfileField(guildId, discordId) {
  try {
    const settings = await getRobloxSettings();
    if (!settings.enabled || !settings.showOnProfiles || !settings.bloxlinkEnabled) return null;
    const result = await getMemberRoblox({ guildId: guildId || '', discordId });
    if (result.status !== 'linked') return null;
    return robloxProfileField({
      robloxUsername: result.profile?.username || null,
      robloxDisplayName: result.profile?.displayName || null,
      robloxUserId: result.robloxId || null,
      // `displayMode` is the operator's choice between a one-line and a fuller
      // Roblox block on the profile.
      mode: settings.displayMode === 'full' ? 'full' : 'compact',
      status: result.status,
    });
  } catch (error) {
    console.error('[bot] roblox profile field failed:', error.message);
    return null;
  }
}

/**
 * The inviter's display name.
 *
 * The recorded tag is preferred, since it survives an inviter who later leaves
 * the server; a live member lookup is the fallback. Anything else is `Unknown`
 * rather than a raw id.
 */
async function resolveInviterName(guild, join) {
  if (!join) return null;
  if (join.inviterTag) return join.inviterTag;
  if (join.inviterId) {
    const member = await guild.members.fetch(join.inviterId).catch(() => null);
    if (member) return member.displayName || member.user?.username || null;
  }
  return null;
}
