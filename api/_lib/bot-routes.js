/**
 * Admin bot-configuration routes.
 *
 * Built as its own router for the same reason `buildMailRouter` is: the
 * serverless dashboard function (`api/admin/index.js`) and the Express dev server
 * (`server/admin-routes.ts`) both mount it with their own guards, so there is one
 * definition of the routes and no risk of the two drifting apart.
 *
 * Access is owner/admin only. A moderator is refused — this page can point the
 * bot at an arbitrary channel and can trigger a real alert, so it is not
 * moderator work. A moderator is refused by the router, not just hidden in the
 * sidebar.
 */
import express from 'express';
import { getBotSettingsForDashboard, saveBotSettings, getAlertState } from './bot-store.js';
import { isValidWebhookUrl, isSnowflake, evaluateUsage, formatQuantity } from './bot-logic.js';
import { fetchUsage, isNeonConfigured } from './neon-usage.js';

/**
 * Builds the bot router.
 *
 * `requireAuth` and `requireRole` are supplied by the caller so the same
 * definitions serve both backends.
 */
export function buildBotRouter({ requireAuth, requireRole }) {
  const router = express.Router();

  // Owner and admin only, mirroring the mail workspace's rule.
  const botGuard = [requireAuth, requireRole('admin')];

  const fail = (res, error, message) => {
    console.error('Bot API error:', error);
    const isMissingSchema = String(error?.message || '').includes('does not exist');
    res.status(500).json({
      message: isMissingSchema
        ? 'Bot storage is not available yet; the schema is created on first save'
        : message,
    });
  };

  /* ---------------------------------------------------------------- settings */

  router.get('/api/admin/bot/settings', ...botGuard, async (_req, res) => {
    try {
      const settings = await getBotSettingsForDashboard();
      res.json({
        ...settings,
        alertState: await getAlertState().catch(() => ({})),
      });
    } catch (error) {
      fail(res, error, 'Failed to load bot settings');
    }
  });

  router.put('/api/admin/bot/settings', ...botGuard, async (req, res) => {
    try {
      const body = req.body || {};

      // Validate before writing, so a typo cannot silently point the alert at
      // nothing. An empty value is always allowed — it means "clear".
      if (body.alertChannelId && !isSnowflake(String(body.alertChannelId))) {
        return res.status(400).json({ message: 'The alert channel must be a Discord channel ID (a 17-20 digit number)' });
      }
      if (body.alertWebhookUrl && !isValidWebhookUrl(String(body.alertWebhookUrl))) {
        return res.status(400).json({ message: 'That does not look like a Discord webhook URL' });
      }
      if (body.prefix !== undefined && !String(body.prefix).trim()) {
        return res.status(400).json({ message: 'The command prefix cannot be empty' });
      }
      for (const key of ['alertThresholdPercent', 'alertCooldownMinutes', 'computeLimitSeconds', 'storageLimitBytes', 'transferLimitBytes']) {
        if (body[key] !== undefined && body[key] !== '' && !Number.isFinite(Number(body[key]))) {
          return res.status(400).json({ message: `${key} must be a number` });
        }
      }

      const settings = await saveBotSettings(body, req.session?.adminId || null);
      res.json({ ...settings, message: 'Bot settings saved' });
    } catch (error) {
      fail(res, error, 'Failed to save bot settings');
    }
  });

  /* ------------------------------------------------------------------ status */

  /**
   * What the dashboard shows on the Bot page header.
   *
   * Reports only whether a secret is present, never its value — the same rule
   * the mail settings diagnostics follow for the Mailjet keys.
   */
  router.get('/api/admin/bot/status', ...botGuard, async (_req, res) => {
    try {
      const settings = await getBotSettingsForDashboard();
      res.json({
        enabled: settings.enabled,
        prefix: settings.prefix,
        botTokenConfigured: settings.botTokenConfigured,
        neonKeyConfigured: settings.neonKeyConfigured,
        projectIdConfigured: Boolean(process.env.NEON_PROJECT_ID),
        destinations: {
          channel: Boolean(settings.alertChannelId),
          webhook: settings.webhookConfigured,
        },
        neon: isNeonConfigured(),
      });
    } catch (error) {
      fail(res, error, 'Failed to read bot status');
    }
  });

  /**
   * Diagnostic: reads Neon usage and evaluates the alert WITHOUT sending it.
   *
   * This is what lets an operator verify the API key, the project id and the
   * configured limits from the deployment that is actually running, without
   * spamming the alert channel. It returns the same numbers the alert would, so
   * "the bot is silent" can be told apart from "usage is genuinely low".
   */
  router.post('/api/admin/bot/usage-preview', ...botGuard, async (_req, res) => {
    if (!isNeonConfigured()) {
      return res.status(400).json({ message: 'NEON_API_KEY is not configured on the server' });
    }
    const projectId = process.env.NEON_PROJECT_ID;
    if (!projectId) {
      return res.status(400).json({ message: 'NEON_PROJECT_ID is not configured on the server' });
    }

    try {
      const settings = await getBotSettingsForDashboard();
      const { usage, unavailable, from, to } = await fetchUsage({ projectId });
      const evaluation = evaluateUsage(usage, settings, settings.alertThresholdPercent);

      res.json({
        projectId,
        window: { from, to },
        usage: Object.fromEntries(
          evaluation.metrics.map((metric) => [
            metric.key,
            {
              used: metric.used,
              formatted: formatQuantity(metric.used, metric.unit),
              limit: metric.limit,
              percent: Number(metric.percent.toFixed(1)),
              level: metric.level,
            },
          ]),
        ),
        level: evaluation.level,
        wouldAlert: evaluation.level !== 'ok',
        thresholdPercent: evaluation.thresholdPercent,
        unavailable,
      });
    } catch (error) {
      fail(res, error, 'Failed to read Neon usage');
    }
  });

  return router;
}
