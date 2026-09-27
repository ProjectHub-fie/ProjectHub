/**
 * WispByte-friendly entrypoint for the ProjectHub Discord bot.
 *
 * WispByte's Node.js servers commonly start with `node index.js`. The actual
 * bot stays in bot/index.js so the Vercel web app remains independent.
 *
 * The bot is a standalone package: run it from its own directory with
 * `cd bot && npm install && node index.js`. This launcher is kept for a host
 * whose startup command runs from the repository root; it imports the same
 * `main()` and needs the same `bot/` tree, so it does not require the website's
 * dependencies either.
 */
import { main } from './bot/index.js';

main().catch((error) => {
  console.error('[bot] fatal:', error);
  process.exitCode = 1;
});