/** Handles a client-level discord.js error. */
export function handleError(error, { redactToken }) {
  console.error('[bot] client error:', redactToken(error?.message));
}