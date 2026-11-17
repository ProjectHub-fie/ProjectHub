/**
 * Admin routes for the Discord Forum ↔ GitHub Issues integration, plus the
 * public webhook receiver.
 *
 * Built as its own router for the same reason `buildBotRouter` and
 * `buildRobloxRouter` are: the serverless dashboard function
 * (`api/admin/index.js`) and the Express dev server (`server/admin-routes.ts`)
 * both mount it with their own guards, so there is one definition of the routes
 * and no risk of the two drifting apart.
 *
 * Access to the configuration routes is owner/admin only, mirroring the bot,
 * mail and Roblox workspaces. The router can add a repository mapping and can
 * trigger a live GitHub call, so a moderator is refused by the router itself,
 * not merely hidden in the sidebar.
 *
 * The webhook receiver is separate: it is called by GitHub, not an
 * administrator, so it authenticates with the HMAC signature instead of a
 * session. It is exported as `handleGithubWebhookRequest` and registered on the
 * app directly, the same way the mail inbound webhook is.
 *
 * No secret is ever returned: the GitHub App private key and the webhook secret
 * are environment-only, and the settings response reports only whether each is
 * present.
 */
import express from 'express';
import { isSnowflake } from '../../bot/lib/bot-logic.js';
import {
  repositoryProblem,
  parseRepositoryFullName,
  JOB_STATUS,
} from '../../bot/lib/github-forum-logic.js';
import {
  getGithubForumSettingsForDashboard,
  saveGithubForumSettings,
  listMappings,
  upsertMapping,
  deleteMapping,
  listIssueLinks,
  listSyncLogs,
  listJobs,
  retryJob,
  getSyncStats,
} from '../../bot/lib/github-forum-store.js';
import { getIntegrationHealth } from '../../bot/lib/github-forum-service.js';
import { checkRepositoryAccess, isGithubAppConfigured, isWebhookConfigured } from '../../bot/lib/github-forum-client.js';
import { handleGithubWebhook } from '../../bot/lib/github-forum-webhook.js';

/**
 * Builds the integration router. `requireAuth` and `requireRole` come from the
 * caller so the same definitions serve both backends.
 */
export function buildGithubForumRouter({ requireAuth, requireRole }) {
  const router = express.Router();
  const guard = [requireAuth, requireRole('admin')];

  const fail = (res, error, message) => {
    console.error('GitHub forum API error:', error);
    const isMissingSchema = String(error?.message || '').includes('does not exist');
    res.status(500).json({
      message: isMissingSchema
        ? 'GitHub integration storage is not available yet; the schema is created on first save'
        : message,
    });
  };

  /* -------------------------------------------------------------- settings */

  router.get('/api/admin/github-forum/settings', ...guard, async (_req, res) => {
    try {
      res.json(await getGithubForumSettingsForDashboard());
    } catch (error) {
      fail(res, error, 'Failed to load GitHub integration settings');
    }
  });

  router.put('/api/admin/github-forum/settings', ...guard, async (req, res) => {
    try {
      const body = req.body || {};
      // A channel or guild id must be a Discord snowflake when present; empty
      // means "clear".
      for (const key of ['forumChannelId', 'guildId']) {
        if (body[key] && !isSnowflake(String(body[key]))) {
          return res.status(400).json({ message: `${key} must be a Discord id (a 17-20 digit number)` });
        }
      }
      const settings = await saveGithubForumSettings(body, req.session?.adminId || null);
      res.json({ ...settings, message: 'GitHub integration settings saved' });
    } catch (error) {
      fail(res, error, 'Failed to save GitHub integration settings');
    }
  });

  /* -------------------------------------------------------------- overview */

  router.get('/api/admin/github-forum/overview', ...guard, async (_req, res) => {
    try {
      const health = await getIntegrationHealth();
      const stats = await getSyncStats();
      const links = await listIssueLinks({ limit: 8 });
      res.json({
        ...health,
        forumChannelId: (await getGithubForumSettingsForDashboard()).forumChannelId,
        stats,
        recentLinks: links.map((link) => ({
          threadId: link.discordThreadId,
          repository: link.repository,
          issueNumber: link.githubIssueNumber,
          issueUrl: link.githubIssueUrl,
          state: link.issueState,
          createdAt: link.createdAt,
        })),
      });
    } catch (error) {
      fail(res, error, 'Failed to read the GitHub integration overview');
    }
  });

  /* -------------------------------------------------------------- mappings */

  router.get('/api/admin/github-forum/mappings', ...guard, async (_req, res) => {
    try {
      res.json({ mappings: await listMappings() });
    } catch (error) {
      fail(res, error, 'Failed to list repository mappings');
    }
  });

  router.post('/api/admin/github-forum/mappings', ...guard, async (req, res) => {
    try {
      const body = req.body || {};
      if (!isSnowflake(String(body.discordTagId || ''))) {
        return res.status(400).json({ message: 'The Discord tag id must be a snowflake (a 17-20 digit number)' });
      }
      const problem = repositoryProblem(body.githubOwner, body.githubRepository);
      if (problem) return res.status(400).json({ message: problem });

      const result = await upsertMapping(
        {
          discordTagId: String(body.discordTagId).trim(),
          discordTagName: body.discordTagName ? String(body.discordTagName).slice(0, 100) : null,
          githubOwner: String(body.githubOwner).trim(),
          githubRepository: String(body.githubRepository).trim(),
          enabled: body.enabled === undefined ? true : Boolean(body.enabled),
        },
        req.session?.adminId || null,
      );
      if (!result.ok && result.reason === 'duplicate_tag') {
        return res.status(409).json({ message: 'That Discord tag is already mapped to a repository' });
      }
      res.status(201).json({ mapping: result.mapping, message: 'Mapping created' });
    } catch (error) {
      fail(res, error, 'Failed to create the mapping');
    }
  });

  router.put('/api/admin/github-forum/mappings/:id', ...guard, async (req, res) => {
    try {
      const body = req.body || {};
      if (!isSnowflake(String(body.discordTagId || ''))) {
        return res.status(400).json({ message: 'The Discord tag id must be a snowflake (a 17-20 digit number)' });
      }
      const problem = repositoryProblem(body.githubOwner, body.githubRepository);
      if (problem) return res.status(400).json({ message: problem });

      const result = await upsertMapping(
        {
          id: req.params.id,
          discordTagId: String(body.discordTagId).trim(),
          discordTagName: body.discordTagName ? String(body.discordTagName).slice(0, 100) : null,
          githubOwner: String(body.githubOwner).trim(),
          githubRepository: String(body.githubRepository).trim(),
          enabled: body.enabled === undefined ? true : Boolean(body.enabled),
        },
        req.session?.adminId || null,
      );
      if (!result.ok) {
        if (result.reason === 'not_found') return res.status(404).json({ message: 'Mapping not found' });
        if (result.reason === 'duplicate_tag') {
          return res.status(409).json({ message: 'That Discord tag is already mapped to a repository' });
        }
      }
      res.json({ mapping: result.mapping, message: 'Mapping updated' });
    } catch (error) {
      fail(res, error, 'Failed to update the mapping');
    }
  });

  router.delete('/api/admin/github-forum/mappings/:id', ...guard, async (req, res) => {
    try {
      const removed = await deleteMapping(req.params.id);
      if (!removed) return res.status(404).json({ message: 'Mapping not found' });
      res.json({ message: 'Mapping removed' });
    } catch (error) {
      fail(res, error, 'Failed to remove the mapping');
    }
  });

  /**
   * Validates that the App installation can see a repository.
   *
   * A live GitHub call, so it is only run when the operator asks. It returns an
   * actionable message for the "not installed" and "no permission" cases, which
   * is the whole point: an operator learns a repository is unreachable before a
   * Forum post fails.
   */
  router.post('/api/admin/github-forum/validate', ...guard, async (req, res) => {
    const fullName = String(req.body?.repository || '').trim();
    const parsed = parseRepositoryFullName(fullName);
    if (!parsed) {
      return res.status(400).json({ message: 'Enter a repository as owner/name' });
    }
    try {
      const result = await checkRepositoryAccess({ owner: parsed.owner, repository: parsed.repository });
      res.json(result);
    } catch (error) {
      fail(res, error, 'Failed to validate the repository');
    }
  });

  /* ------------------------------------------------------------------ logs */

  router.get('/api/admin/github-forum/logs', ...guard, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const status = req.query.status ? String(req.query.status).slice(0, 32) : null;
      res.json({ logs: await listSyncLogs({ status, limit }) });
    } catch (error) {
      fail(res, error, 'Failed to list synchronization logs');
    }
  });

  router.get('/api/admin/github-forum/jobs', ...guard, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const status = req.query.status ? String(req.query.status).slice(0, 32) : null;
      res.json({ jobs: await listJobs({ status, limit }) });
    } catch (error) {
      fail(res, error, 'Failed to list synchronization jobs');
    }
  });

  /**
   * Re-queues a failed or parked job by hand.
   *
   * Only a job that is not already running may be retried, so this cannot create
   * a second concurrent processing of the same job.
   */
  router.post('/api/admin/github-forum/jobs/:id/retry', ...guard, async (req, res) => {
    try {
      const jobs = await listJobs({ limit: 200 });
      const job = jobs.find((candidate) => candidate.id === String(req.params.id));
      if (!job) return res.status(404).json({ message: 'Job not found' });
      if (job.status === JOB_STATUS.PROCESSING) {
        return res.status(409).json({ message: 'That job is currently processing' });
      }
      const updated = await retryJob(req.params.id);
      res.json({ job: updated, message: 'Job queued for retry' });
    } catch (error) {
      fail(res, error, 'Failed to retry the job');
    }
  });

  /* ----------------------------------------------------------------- links */

  router.get('/api/admin/github-forum/links', ...guard, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const state = req.query.state ? String(req.query.state).slice(0, 16) : null;
      res.json({ links: await listIssueLinks({ limit, state }) });
    } catch (error) {
      fail(res, error, 'Failed to list linked issues');
    }
  });

  return router;
}

/**
 * The public GitHub webhook receiver.
 *
 * Registered on the app directly (before the admin router) because GitHub calls
 * it, not an administrator. It reads the raw body captured by the JSON
 * middleware's `verify` hook, verifies the HMAC signature, deduplicates the
 * delivery and enqueues a job. It never touches Discord, so it stays a fast
 * request/response.
 */
export function handleGithubWebhookRequest() {
  return async (req, res) => {
    try {
      const rawBody = req.rawBody ?? req.body ?? Buffer.alloc(0);
      const result = await handleGithubWebhook({
        rawBody: Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8'),
        headers: req.headers,
        env: process.env,
      });
      // GitHub reads the body on a failure, so a message is always sent.
      res.status(result.status).json(result.body);
    } catch (error) {
      console.error('GitHub webhook error:', error);
      res.status(500).json({ message: 'Failed to process the webhook' });
    }
  };
}

/** Whether the GitHub App credentials and webhook secret are present. */
export function githubIntegrationStatus(env = process.env) {
  return {
    appConfigured: isGithubAppConfigured(env),
    webhookConfigured: isWebhookConfigured(env),
  };
}

export { handleGithubWebhook };
