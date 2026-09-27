import { ActivityType } from 'discord.js';
import { snapshotInvites } from '../lib/bot-store.js';

/**
 * Creates the one-time handler for the first ready gateway event.
 *
 * Besides the banner and presence, this seeds the invite snapshot for every
 * guild the bot is in. Without that seed the first join after a restart would
 * look like every invite gained a use, and the attribution would be arbitrary.
 * The seed is best-effort: a guild whose invites cannot be read is skipped, and
 * the join handler refreshes the snapshot anyway.
 */
export function createReadyHandler({ prefix, logBoot }) {
  return (ready) => {
    const guilds = ready.guilds.cache.map((guild) => `${guild.name} (${guild.id})`);
    console.log(`[bot] signed in as ${ready.user.tag} (id ${ready.user.id})`);
    console.log(`[bot] in ${guilds.length} guild(s): ${guilds.join(', ') || 'none'}`);

    // The first heartbeat has not been acked yet, so ping is -1 until one is.
    const ping = ready.ws.ping >= 0 ? `${ready.ws.ping}ms` : 'not yet measured';
    console.log(`[bot] gateway ready, ws ping ${ping}`);
    logBoot('ready: user=%s guilds=%o ping=%s', ready.user.tag, guilds, ping);

    ready.user.setPresence({
      activities: [{ name: 'ProjectHub.inc', type: ActivityType.Watching }],
      status: 'online',
    });

    void primeInviteSnapshots(ready).catch((error) =>
      console.error('[bot] invite snapshot seed failed:', error.message),
    );
  };
}

/** Seeds the invite snapshot for every guild so the first join is attributed. */
export async function primeInviteSnapshots(client) {
  for (const guild of client.guilds.cache.values()) {
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) continue;
    await snapshotInvites(
      guild.id,
      [...invites.values()].map((invite) => ({
        code: invite.code,
        inviterId: invite.inviterId || null,
        inviterTag: invite.inviter?.tag || invite.inviter?.username || null,
        uses: Number(invite.uses) || 0,
      })),
    );
  }
}