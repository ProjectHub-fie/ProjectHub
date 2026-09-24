/**
 * The ProjectHub Discord bot.
 *
 * This is a long-running process, not a serverless function. A prefix bot with
 * mention replies needs a persistent gateway WebSocket, and a Vercel function is
 * request-scoped and cannot hold one, so the bot has to run somewhere that keeps
 * a process alive (a VPS, Railway, Fly, Render, or Docker). The dashboard half of
 * this feature — configuration and status — still works on Vercel, because it is
 * ordinary request/response; only this file needs a persistent host.
 *
 * What it does:
 *
 *   - Reads the message stream, so `&`-prefixed commands and @-mentions work.
 *   - `&dev` reports the site role of whoever asks, resolved from the Discord id
 *     they linked in the admin portal (or the client portal).
 *   - Replies when the bot is mentioned, so it works in a server where members
 *     expect to just @ it.
 *   - Polls Neon consumption and posts a usage embed to the configured channel
 *     and webhook when a metric crosses the tier threshold.
 *
 * Configuration is read from the database on a short interval, so changing the
 * channel or the threshold in the dashboard takes effect without restarting the
 * bot. The bot token and Neon API key come from the environment; they are never
 * loaded from the database or written to it.
 */
import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, EmbedBuilder, Events } from 'discord.js';
import {
  BOT_PREFIX,
  parseCommand,
  resolveRoles,
  evaluateUsage,
  shouldAlert,
  buildAlertEmbed,
  formatQuantity,
  formatPercent,
  isValidWebhookUrl,
} from '../api/_lib/bot-logic.js';
import { getBotSettings, getAlertState, recordAlertTimes, resolveDiscordIdentity } from '../api/_lib/bot-store.js';
import { fetchUsage, fetchProjectName, isNeonConfigured } from '../api/_lib/neon-usage.js';

const POLL_INTERVAL_MS = Number(process.env.BOT_POLL_INTERVAL_MINUTES || 15) * 60 * 1000;
const SETTINGS_REFRESH_MS = 60 * 1000;

let settings = null;
let settingsLoadedAt = 0;

/**
 * The current configuration, refreshed on a short interval.
 *
 * A dashboard edit should not require an operator to restart the bot, so the
 * cached value expires rather than being read once at boot. A read failure keeps
 * the last good value instead of clearing it.
 */
export async function currentSettings() {
  const now = Date.now();
  if (settings && now - settingsLoadedAt < SETTINGS_REFRESH_MS) return settings;
  try {
    settings = await getBotSettings();
    settingsLoadedAt = now;
  } catch (error) {
    console.error('[bot] could not read settings:', error.message);
    // Fall back to the cached value; a database blip must not turn commands off.
  }
  return settings || { prefix: BOT_PREFIX, enabled: false };
}

/* ------------------------------------------------------------------- client */

export function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    // A DM needs the channel partial to arrive at all.
    partials: [Partials.Channel],
  });
}

/**
 * Routes one message: a mention first, then a prefix command.
 *
 * The mention path exists because members treat an @ as "talk to the bot" and
 * should not have to remember the prefix. It answers the same `&dev` question
 * when the mention carries no command, so `@ProjectHub` and `@ProjectHub dev`
 * both work.
 */
export async function handleMessage(message) {
  if (!message || message.author?.bot) return undefined;

  const config = await currentSettings();
  const mentioned = message.mentions?.has?.(message.client?.user?.id);

  if (mentioned) {
    // Strip the mention so the remainder parses like a prefixed command.
    const stripped = message.content.replace(/<@!?\d+>/g, '').trim();
    const parsed = parseCommand(stripped, '') || { command: 'dev', args: [], rest: '' };
    return runCommand(parsed, message, config, { via: 'mention' });
  }

  const parsed = parseCommand(message.content, config.prefix || BOT_PREFIX);
  if (!parsed) return undefined;
  return runCommand(parsed, message, config, { via: 'prefix' });
}

async function runCommand(parsed, message, config, { via }) {
  switch (parsed.command) {
    case 'dev':
      return handleDev(message, { via });
    case 'help':
      return message.reply(
        `ProjectHub commands:\n\`${config.prefix || BOT_PREFIX}dev\` — your role on the ProjectHub site.\n` +
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
 * `&dev` — reports the site role of the person asking.
 *
 * The lookup goes through the Discord id linked in the admin portal, falling
 * back to the client portal, so one command answers for both kinds of account.
 * An unlinked account is told how to link rather than being silently ignored.
 */
export async function handleDev(message, { via } = {}) {
  const discordId = message.author?.id;
  if (!discordId) return undefined;

  let identity;
  try {
    identity = await resolveDiscordIdentity(discordId);
  } catch (error) {
    console.error('[bot] role lookup failed:', error.message);
    return message.reply('I could not reach the ProjectHub database just now. Try again shortly.');
  }

  const resolved = resolveRoles(identity);
  const embed = new EmbedBuilder()
    .setColor(resolved.isBlocked ? 0xef4444 : resolved.isAdmin ? 0x6366f1 : 0x22c55e)
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL?.() })
    .setTitle('ProjectHub role')
    .setTimestamp();

  if (!resolved.isLinked) {
    embed
      .setDescription('This Discord account is not linked to a ProjectHub account.')
      .addFields({
        name: 'How to link',
        value:
          'Sign in at the ProjectHub site, open **Settings**, and choose **Link Discord**.' +
          ' Administrators link from the admin portal settings page instead.',
      });
    return message.reply({ embeds: [embed] });
  }

  embed.setDescription(
    resolved.roles
      .map((role) =>
        role.scope === 'admin'
          ? `**Admin portal** — \`${role.label}\``
          : `**Client portal** — \`${role.label}\`${role.blocked ? ' (account is blocked)' : ''}`,
      )
      .join('\n'),
  );

  if (identity.user) {
    const name = [identity.user.firstName, identity.user.lastName].filter(Boolean).join(' ');
    embed.addFields({
      name: 'Client account',
      value: name || identity.user.username || identity.user.email || 'linked',
      inline: true,
    });
  }

  if (via === 'mention') embed.setFooter({ text: 'Resolved from your linked Discord account' });

  return message.reply({ embeds: [embed] });
}

/* --------------------------------------------------------------- usage alert */

/**
 * One usage check: read Neon, evaluate, and post if something crossed.
 *
 * Split from the timer so the dashboard's test action and the tests can invoke it
 * without waiting for an interval.
 */
export async function runUsageCheck({ client = null, now = Date.now(), fetchImpl = fetch, force = false } = {}) {
  const config = await currentSettings();
  if (!config.enabled && !force) return { skipped: 'disabled' };
  if (!isNeonConfigured()) return { skipped: 'no_neon_key' };

  const projectId = process.env.NEON_PROJECT_ID;
  if (!projectId) return { skipped: 'no_project_id' };

  let usage;
  try {
    usage = await fetchUsage({ projectId, fetchImpl });
  } catch (error) {
    console.error('[bot] usage read failed:', error.message);
    return { skipped: 'read_failed', error: error.message };
  }

  const evaluation = evaluateUsage(usage.usage, config, config.alertThresholdPercent);
  const lastAlertedAt = await getAlertState().catch(() => ({}));
  const decision = shouldAlert({
    evaluation,
    lastAlertedAt,
    now,
    cooldownMinutes: config.alertCooldownMinutes,
  });

  if (!decision.alert) return { evaluation, decision, sent: false };

  const projectName = config.projectName || (await fetchProjectName(projectId, fetchImpl));
  const embed = buildAlertEmbed({
    projectName,
    projectId,
    evaluation: { ...evaluation, metrics: decision.breaching },
    at: new Date(now),
  });

  const delivery = await deliverAlert(embed, config, client);
  // Only mark the metrics that actually reached a destination, so a total
  // delivery failure retries next poll.
  if (delivery.channel || delivery.webhook) {
    await recordAlertTimes(decision.marks).catch((error) =>
      console.error('[bot] could not record alert state:', error.message),
    );
  }

  if (usage.unavailable?.length) {
    console.warn('[bot] metrics unavailable this poll:', usage.unavailable.map((u) => u.key).join(', '));
  }

  return { evaluation, decision, embed, delivery, sent: Boolean(delivery.channel || delivery.webhook) };
}

/**
 * Posts an alert to the channel and the webhook.
 *
 * Both destinations are attempted independently: the webhook is specified as an
 * independent copy, so a misconfigured channel must not suppress it.
 */
export async function deliverAlert(embed, config, client) {
  const result = { channel: false, webhook: false };

  if (client && config.alertChannelId) {
    try {
      const channel = await client.channels.fetch(config.alertChannelId);
      if (channel?.isTextBased?.()) {
        await channel.send({ embeds: [embed] });
        result.channel = true;
      }
    } catch (error) {
      console.error('[bot] channel alert failed:', error.message);
    }
  }

  if (config.alertWebhookUrl && isValidWebhookUrl(config.alertWebhookUrl)) {
    try {
      const response = await fetch(config.alertWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // allowed_mentions is pinned off: a usage alert must never ping the
        // channel, and a webhook post can otherwise mention roles.
        body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
      });
      if (!response.ok) throw new Error(`webhook responded ${response.status}`);
      result.webhook = true;
    } catch (error) {
      console.error('[bot] webhook alert failed:', error.message);
    }
  }

  return result;
}

/** A human summary of the current usage, used by the dashboard test action. */
export function summarizeUsage(evaluation) {
  return evaluation.metrics
    .map(
      (metric) =>
        `${metric.label}: ${formatPercent(metric.percent)}% (${formatQuantity(metric.used, metric.unit)} / ${formatQuantity(metric.limit, metric.unit)})`,
    )
    .join(' · ');
}

/* ------------------------------------------------------------------- start */

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error('[bot] DISCORD_BOT_TOKEN is not set; refusing to start.');
    process.exit(1);
  }

  const client = createClient();

  client.on(Events.MessageCreate, (message) => {
    handleMessage(message).catch((error) => console.error('[bot] message handling failed:', error));
  });
  client.on(Events.Error, (error) => console.error('[bot] client error:', error.message));
  client.once(Events.ClientReady, (ready) => console.log(`[bot] signed in as ${ready.user.tag}`));

  await client.login(token);

  const tick = async () => {
    try {
      const result = await runUsageCheck({ client });
      if (result.sent) console.log('[bot] usage alert sent:', summarizeUsage(result.evaluation));
    } catch (error) {
      console.error('[bot] usage poll failed:', error.message);
    }
  };

  // Give the gateway a moment to be ready before the first poll.
  setTimeout(tick, 10_000);
  setInterval(tick, POLL_INTERVAL_MS);

  const shutdown = async () => {
    console.log('[bot] shutting down');
    await client.destroy();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only start when executed directly, so importing this module in a test does not
// open a gateway connection.
if (process.argv[1] && process.argv[1].endsWith('bot/index.js')) {
  main().catch((error) => {
    console.error('[bot] fatal:', error);
    process.exit(1);
  });
}
