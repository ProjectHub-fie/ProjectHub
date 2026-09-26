/** Handles a warning emitted by discord.js. */
export function handleWarn(message, { redactToken }) {
  console.warn('[bot] gateway warning:', redactToken(message));
}