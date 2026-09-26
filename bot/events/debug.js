/** Handles discord.js gateway debug messages. */
export function handleDebug(message, { logGateway, redactToken }) {
  logGateway('%s', redactToken(message));
}