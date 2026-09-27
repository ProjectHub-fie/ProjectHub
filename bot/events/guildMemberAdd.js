import { getInviteSnapshot, recordInviteUse, snapshotInvites } from '../lib/bot-store.js';

/**
 * Creates the guildMemberAdd handler that attributes each join to an invite.
 *
 * Discord's invite objects expose only a running `uses` count, not who used
 * them, so the bot keeps a snapshot and the invite whose count grew is the one
 * used. This is a best-effort side effect: an invite read that fails must never
 * stop the member from joining, and a join that cannot be attributed is simply
 * left unattributed (the profile shows `Unknown`).
 */
export function createGuildMemberAddHandler({ logInvite = null } = {}) {
  return async (member) => {
    try {
      const guild = member.guild;
      const invite = await findUsedInvite(guild);
      if (!invite) return;
      await recordInviteUse(guild.id, member.id, invite);
      logInvite?.('join %s attributed to %s', member.id, invite.inviterTag || invite.inviterId || 'unknown');
    } catch (error) {
      console.error('[bot] invite attribution failed:', error.message);
    }
  };
}

/**
 * Finds which invite gained a use by diffing the live invite list against the
 * snapshot. Returns `{ code, inviterId, inviterTag, uses }`, or null when no
 * invite changed (for example, a vanity URL or a manually added member).
 */
export async function findUsedInvite(guild) {
  const live = await guild.invites.fetch().catch(() => null);
  if (!live) return null;

  const previous = await getInviteSnapshot(guild.id);

  let used = null;
  for (const invite of live.values()) {
    const before = previous[invite.code];
    const beforeUses = before ? Number(before.uses) || 0 : 0;
    const nowUses = Number(invite.uses) || 0;
    if (nowUses > beforeUses) {
      used = {
        code: invite.code,
        inviterId: invite.inviterId || before?.inviterId || null,
        inviterTag: invite.inviter?.tag || invite.inviter?.username || before?.inviterTag || null,
        uses: nowUses,
      };
      break;
    }
  }

  // Refresh the snapshot for every invite either way, so the next join compares
  // against current counts rather than repeatedly detecting the same growth.
  await snapshotInvites(
    guild.id,
    [...live.values()].map((invite) => ({
      code: invite.code,
      inviterId: invite.inviterId || null,
      inviterTag: invite.inviter?.tag || invite.inviter?.username || null,
      uses: Number(invite.uses) || 0,
    })),
  );

  return used;
}
