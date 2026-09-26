import { Events } from 'discord.js';
import { handleDebug } from './debug.js';
import { handleError } from './error.js';
import { createMessageCreateHandler } from './messageCreate.js';
import { createReadyHandler } from './ready.js';
import { handleShardDisconnect } from './shardDisconnect.js';
import { handleShardError } from './shardError.js';
import { handleShardReady } from './shardReady.js';
import { handleShardReconnecting } from './shardReconnecting.js';
import { handleShardResume } from './shardResume.js';
import { handleWarn } from './warn.js';

/**
 * Wires the gateway lifecycle to the console.
 *
 * discord.js emits these on every reconnect, so a network drop that Discord
 * recovers from is visible instead of looking like a bot that stopped working.
 */
export function attachGatewayLogging(client, { logGateway, redactToken }) {
  const options = { logGateway, redactToken };

  client.on(Events.Debug, (message) => handleDebug(message, options));
  client.on(Events.Warn, (message) => handleWarn(message, options));
  client.on(Events.Error, (error) => handleError(error, options));
  client.on(Events.ShardReady, handleShardReady);
  client.on(Events.ShardReconnecting, handleShardReconnecting);
  client.on(Events.ShardResume, handleShardResume);
  client.on(Events.ShardDisconnect, handleShardDisconnect);
  client.on(Events.ShardError, (error, id) => handleShardError(error, id, options));
}

/** Registers every event used by the bot process. */
export function attachBotEvents(client, { handleMessage, prefix, logBoot, logGateway, redactToken }) {
  attachGatewayLogging(client, { logGateway, redactToken });
  client.on(Events.MessageCreate, createMessageCreateHandler({ handleMessage }));
  client.once(Events.ClientReady, createReadyHandler({ prefix, logBoot }));
}