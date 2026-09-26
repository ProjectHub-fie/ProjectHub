import { ActivityType } from 'discord.js';

/** Creates the one-time handler for the first ready gateway event. */
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
      activities: [{ name: `${ready.guilds.cache.size} servers | ${prefix}help`, type: ActivityType.Watching }],
      status: 'online',
    });
  };
}