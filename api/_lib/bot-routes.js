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
import { getBotSettingsForDashboard, saveBotSettings, getAlertState, getBotLiveness } from './bot-store.js';
import { isValidWebhookUrl, isSnowflake, evaluateUsage, formatQuantity } from './bot-logic.js';
import { fetchUsage, fetchProjectNames, projectScopeFromEnv, orgIdFromEnv, isNeonConfigured } from './neon-usage.js';

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
      // Whether the process is actually alive, not merely configured. The token
      // presence below is read from the *web* deployment's environment, so it
      // stays true when the bot host is down; the heartbeat is written by the
      // bot process itself and is what tells the two apart.
      const liveness = await getBotLiveness();
      res.json({
        enabled: settings.enabled,
        prefix: settings.prefix,
        botTokenConfigured: settings.botTokenConfigured,
        neonKeyConfigured: settings.neonKeyConfigured,
        running: liveness.running,
        lastSeenAt: liveness.lastSeenAt,
        staleAfterMs: liveness.staleAfterMs,
        // The scope is every project unless the environment narrows it, so this
        // reports which mode is active rather than demanding a single id.
        scope: projectScopeFromEnv() ? 'projects' : 'org',
        projectIds: projectScopeFromEnv() || [],
        orgId: orgIdFromEnv(),
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
   * This is what lets an operator verify the API key, the scope and the
   * configured limits from the deployment that is actually running, without
   * spamming the alert channel. It returns the same numbers the alert would, so
   * "the bot is silent" can be told apart from "usage is genuinely low".
   *
   * The scope follows the environment: every project by default, or the
   * configured ids. A single project id is no longer required, because an
   * organization-wide quota is the more useful reading.
   */
  router.post('/api/admin/bot/usage-preview', ...botGuard, async (_req, res) => {
    if (!isNeonConfigured()) {
      return res.status(400).json({ message: 'NEON_API_KEY is not configured on the server' });
    }

    try {
      const settings = await getBotSettingsForDashboard();
      const projectIds = projectScopeFromEnv();
      const result = await fetchUsage({ projectIds, orgId: orgIdFromEnv() });
      const evaluation = evaluateUsage(result.usage, settings, settings.alertThresholdPercent);

      // Label the projects the read covered, best-effort.
      const names = await fetchProjectNames(result.perProject.map((p) => p.id));

      res.json({
        scope: result.scope,
        projectIds: projectIds || [],
        projectCount: result.projectCount,
        perProject: result.perProject.map((p) => ({
          id: p.id,
          name: names[p.id] || null,
          computeTimeSeconds: p.computeTimeSeconds || 0,
          formatted: formatQuantity(p.computeTimeSeconds || 0, 'seconds'),
        })),
        window: { from: result.from, to: result.to },
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
        unavailable: result.unavailable,
      });
    } catch (error) {
      fail(res, error, 'Failed to read Neon usage');
    }
  });

  return router;
}
