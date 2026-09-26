/**
 * WispByte-friendly entrypoint for the ProjectHub Discord bot.
 *
 * WispByte's Node.js servers commonly start with `node index.js`. The actual
 * bot stays in bot/index.js so the Vercel web app remains independent.
 */
import { main } from './bot/index.js';

main().catch((error) => {
  console.error('[bot] fatal:', error);
  process.exitCode = 1;
});