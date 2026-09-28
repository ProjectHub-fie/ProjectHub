/**
 * Admin Roblox-integration routes.
 *
 * Built as its own router for the same reason `buildBotRouter` is: the
 * serverless dashboard function (`api/admin/index.js`) and the Express dev server
 * (`server/admin-routes.ts`) both mount it with their own guards, so there is one
 * definition of the routes and no risk of the two drifting apart.
 *
 * Access is owner/admin only, mirroring the bot and mail workspaces. The routes
 * here can force a live Bloxlink lookup (spending quota) and can flip the switch
 * that gates channels behind verification, so a moderator is refused by the
 * router itself, not merely hidden in the sidebar.
 *
 * No secret is ever returned: `BLOXLINK_API_KEY` is environment-only, and the
 * settings response reports only whether it is present.
 */
import express from 'express';
import { isSnowflake } from '../../bot/lib/bot-logic.js';
import {
  ROBLOX_STATUS,
  isValidRobloxUsername,
  robloxStatusLabel,
  normalizeStatus,
} from '../../bot/lib/roblox-logic.js';
import {
  getRobloxSettingsForDashboard,
  saveRobloxSettings,
  listLinks,
  listLinkEvents,
  getRobloxStats,
} from './roblox-store.js';
import { getMemberRoblox, getRobloxProfile } from './roblox-service.js';
import { lookupBloxlinkLink, resolveRobloxUsername, isBloxlinkConfigured, bloxlinkGuildId } from './roblox-client.js';

/**
 * Builds the Roblox router. `requireAuth` and `requireRole` come from the caller
 * so the same definitions serve both backends.
 */
export function buildRobloxRouter({ requireAuth, requireRole }) {
  const router = express.Router();
  const guard = [requireAuth, requireRole('admin')];

  const fail = (res, error, message) => {
    console.error('Roblox API error:', error);
    const isMissingSchema = String(error?.message || '').includes('does not exist');
    res.status(500).json({
      message: isMissingSchema
        ? 'Roblox storage is not available yet; the schema is created on first save'
        : message,
    });
  };

  /* -------------------------------------------------------------- settings */

  router.get('/api/admin/roblox/settings', ...guard, async (_req, res) => {
    try {
      res.json(await getRobloxSettingsForDashboard());
    } catch (error) {
      fail(res, error, 'Failed to load Roblox settings');
    }
  });

  router.put('/api/admin/roblox/settings', ...guard, async (req, res) => {
    try {
      const body = req.body || {};

      // Validate before writing, so a typo cannot silently point a restriction
      // at nothing. An empty value is always allowed — it means "clear".
      for (const key of ['verifiedRoleId', 'unverifiedRoleId', 'verificationChannelId', 'notifyChannelId']) {
        if (body[key] && !isSnowflake(String(body[key]))) {
          return res.status(400).json({ message: `${key} must be a Discord id (a 17-20 digit number)` });
        }
      }
      if (body.verifiedOnlyChannels) {
        const ids = String(body.verifiedOnlyChannels)
          .split(/[\s,]+/)
          .map((id) => id.trim())
          .filter(Boolean);
        const bad = ids.find((id) => !isSnowflake(id));
        if (bad) return res.status(400).json({ message: `"${bad}" is not a Discord channel id` });
      }

      const settings = await saveRobloxSettings(body, req.session?.adminId || null);
      res.json({ ...settings, message: 'Roblox settings saved' });
    } catch (error) {
      fail(res, error, 'Failed to save Roblox settings');
    }
  });

  /* -------------------------------------------------------------- overview */

  /** The overview card: provider status, counts, and the latest links. */
  router.get('/api/admin/roblox/overview', ...guard, async (_req, res) => {
    try {
      const settings = await getRobloxSettingsForDashboard();
      const stats = await getRobloxStats();
      const recent = await listLinkEvents({ limit: 8, type: 'linked' });

      res.json({
        enabled: settings.enabled,
        bloxlinkEnabled: settings.bloxlinkEnabled,
        requireVerification: settings.requireVerification,
        bloxlinkKeyConfigured: settings.bloxlinkKeyConfigured,
        bloxlinkGuildConfigured: settings.bloxlinkGuildConfigured,
        // "Connected" means we can ask Bloxlink at all: the key and the guild are
        // both present. It is not a claim that a live call just succeeded.
        connected: Boolean(settings.bloxlinkKeyConfigured && settings.bloxlinkGuildConfigured),
        provider: 'Bloxlink',
        stats,
        recentLinks: recent.map((event) => ({
          discordId: event.discordId,
          robloxId: event.robloxId,
          at: event.createdAt,
        })),
      });
    } catch (error) {
      fail(res, error, 'Failed to read the Roblox overview');
    }
  });

  /* ----------------------------------------------------------------- links */

  router.get('/api/admin/roblox/links', ...guard, async (req, res) => {
    try {
      const status = req.query.status ? normalizeStatus(req.query.status) : null;
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const links = await listLinks({ status, limit, offset });
      res.json({
        links: links.map((link) => ({
          guildId: link.guildId,
          discordId: link.discordId,
          robloxId: link.robloxId,
          status: link.status,
          statusLabel: robloxStatusLabel(link.status),
          source: link.source,
          linkedAt: link.linkedAt,
          lastCheckedAt: link.lastCheckedAt,
        })),
      });
    } catch (error) {
      fail(res, error, 'Failed to list linked accounts');
    }
  });

  router.get('/api/admin/roblox/events', ...guard, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const type = req.query.type ? String(req.query.type).slice(0, 32) : null;
      res.json({ events: await listLinkEvents({ limit, type }) });
    } catch (error) {
      fail(res, error, 'Failed to list Roblox events');
    }
  });

  /* --------------------------------------------------------- member lookup */

  /**
   * A member's Bloxlink status and public Roblox profile.
   *
   * `force=1` bypasses the cache and asks Bloxlink live — used by the dashboard's
   * Member Lookup, where the operator explicitly wants the current answer.
   */
  router.get('/api/admin/roblox/member/:discordId', ...guard, async (req, res) => {
    const discordId = String(req.params.discordId || '').trim();
    if (!isSnowflake(discordId)) {
      return res.status(400).json({ message: 'A Discord member id (a 17-20 digit number) is required' });
    }
    try {
      const result = await getMemberRoblox({ discordId, force: req.query.force === '1' });
      res.json({
        discordId,
        status: result.status,
        statusLabel: robloxStatusLabel(result.status),
        cached: Boolean(result.cached),
        checkedAt: result.checkedAt,
        profile: result.profile
          ? {
              userId: result.profile.userId,
              username: result.profile.username,
              displayName: result.profile.displayName,
              created: result.profile.created,
              avatarUrl: result.profile.avatarUrl,
              profileUrl: `https://www.roblox.com/users/${result.profile.userId}/profile`,
            }
          : null,
      });
    } catch (error) {
      fail(res, error, 'Failed to look up that member');
    }
  });

  /* --------------------------------------------------------- public lookup */

  /**
   * Public Roblox username lookup.
   *
   * Explicitly *not* a Bloxlink lookup: resolving a username says nothing about
   * which Discord account owns it, and the response says so.
   */
  router.get('/api/admin/roblox/public-lookup', ...guard, async (req, res) => {
    const username = String(req.query.username || '').trim();
    if (!isValidRobloxUsername(username)) {
      return res.status(400).json({ message: 'Enter a Roblox username (3-20 letters, digits or underscores)' });
    }
    try {
      const resolved = await resolveRobloxUsername(username);
      if (!resolved.found) {
        return res.json({
          found: false,
          unavailable: Boolean(resolved.unavailable),
          message: resolved.unavailable
            ? 'The Roblox API could not be reached; try again shortly.'
            : 'No Roblox account with that username.',
        });
      }
      const profile = await getRobloxProfile(resolved.userId);
      res.json({
        found: true,
        verified: false,
        note: 'Public Roblox lookup — this does not link the account to any Discord member.',
        profile: {
          userId: resolved.userId,
          username: resolved.username,
          displayName: resolved.displayName,
          created: profile?.created || null,
          avatarUrl: profile?.avatarUrl || null,
          profileUrl: `https://www.roblox.com/users/${resolved.userId}/profile`,
        },
      });
    } catch (error) {
      fail(res, error, 'Roblox lookup failed');
    }
  });

  /* ----------------------------------------------------------- connectivity */

  /**
   * The Test action.
   *
   * With a `discordId`, it performs a real lookup for that member. Without one,
   * it probes connectivity with a syntactically valid id that will not exist:
   * a working key answers "User not found" (mapped to `not_linked`) whereas a
   * bad key answers "Invalid API Key", which is the distinction the operator
   * needs. The probe is a live call, so it is only run when explicitly asked.
   */
  router.post('/api/admin/roblox/test', ...guard, async (req, res) => {
    const settings = await getRobloxSettingsForDashboard().catch(() => null);
    if (!isBloxlinkConfigured()) {
      return res.json({
        ok: false,
        reason: 'not_configured',
        message: 'BLOXLINK_API_KEY is not set on the server.',
        bloxlinkKeyConfigured: false,
        bloxlinkGuildConfigured: Boolean(bloxlinkGuildId()),
      });
    }
    if (!bloxlinkGuildId()) {
      return res.json({
        ok: false,
        reason: 'no_guild',
        message: 'BLOXLINK_GUILD_ID is not set, so a server-scoped lookup cannot be built.',
        bloxlinkKeyConfigured: true,
        bloxlinkGuildConfigured: false,
      });
    }

    const discordId = String(req.body?.discordId || '').trim();
    if (discordId && !isSnowflake(discordId)) {
      return res.status(400).json({ message: 'That does not look like a Discord member id' });
    }

    try {
      // An id that will not resolve, used only to tell a valid key from an
      // invalid one without needing a real member to test against.
      const probeId = discordId || '999999999999999999';
      const result = await lookupBloxlinkLink({ discordId: probeId });
      const ok = result.status === ROBLOX_STATUS.LINKED || result.status === ROBLOX_STATUS.NOT_LINKED;
      res.json({
        ok,
        reason: ok ? (result.status === ROBLOX_STATUS.LINKED ? 'linked' : 'reachable') : result.status,
        detail: result.reason || null,
        status: result.status,
        statusLabel: robloxStatusLabel(result.status),
        robloxId: result.robloxId || null,
        message: ok
          ? discordId
            ? `Bloxlink answered for ${discordId}: ${robloxStatusLabel(result.status)}.`
            : 'Bloxlink answered with the configured key and guild.'
          : `Bloxlink could not be reached, or rejected the key${result.reason ? ` (${result.reason})` : ''}. ` +
            'Check that BLOXLINK_API_KEY is a valid server key for BLOXLINK_GUILD_ID.',
        bloxlinkKeyConfigured: true,
        bloxlinkGuildConfigured: true,
      });
    } catch (error) {
      fail(res, error, 'Bloxlink test failed');
    }
  });

  return router;
}
