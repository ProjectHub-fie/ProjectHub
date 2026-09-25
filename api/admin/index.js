/**
 * Vercel serverless function for the administration dashboard (/pbad).
 *
 * The public API runs from api/index.js with token-based auth, but the dashboard
 * needs a real server-side session (an anonymous visitor must never reach admin
 * data). This function owns every /api/admin/* endpoint and is wired up in
 * vercel.json, so the public handler stays untouched.
 *
 * It intentionally mirrors server/admin-routes.ts. Vercel serverless functions
 * cannot import the TypeScript server without an extra build step, and this
 * repository already follows the same "shared helper in api/lib" pattern for the
 * public handler.
 */
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import postgres from 'postgres';
import crypto from 'node:crypto';
import { describeDbError, normalizeDatabaseUrl } from '../_lib/db.js';
import { parseCookies } from '../_lib/session-token.js';
import { buildMailRouter, handleInboundMessage } from '../_lib/mail-routes.js';
import { buildBotRouter } from '../_lib/bot-routes.js';
import { buildTestRouter } from '../_lib/suite-runner.js';
import { ingestMessage, createMailNotifications, ensureMailSchema, purgeAdminMailData } from '../_lib/mail-store.js';

const sql = postgres(normalizeDatabaseUrl(process.env.DATABASE_URL), { ssl: 'require', max: 5 });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const ROLE_HIERARCHY = ['moderator', 'admin', 'owner'];

/**
 * Creates the dashboard table if the shared database does not have it yet.
 * Mirrors the auto-seed convention already used by api/_lib/storage.js, so the
 * dashboard works on a fresh database without a separate migration step.
 * Cached so the DDL runs at most once per serverless instance.
 */
let schemaReady = null;
const ensureAdminSchema = () => {
  schemaReady ||= (async () => {
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS admin_credentials (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          email text UNIQUE,
          pin text NOT NULL UNIQUE,
          password_hash text NOT NULL,
          role text DEFAULT 'moderator' NOT NULL,
          discord_id text,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `;
      // Added after the table shipped, so an existing deployment gains it here.
      // The unique index keeps one Discord account mapped to one administrator;
      // the column-level UNIQUE on a fresh create would not reach a table that
      // already existed.
      await sql`ALTER TABLE admin_credentials ADD COLUMN IF NOT EXISTS discord_id text`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS admin_credentials_discord_id_idx ON admin_credentials (discord_id) WHERE discord_id IS NOT NULL`;
    } catch (error) {
      schemaReady = null;
      throw error;
    }
  })();
  return schemaReady;
};

const getAdminByPin = async (pin) => {
  await ensureAdminSchema();
  const rows = await sql`SELECT * FROM admin_credentials WHERE pin = ${pin} LIMIT 1`;
  return rows[0] || null;
};

const getAdminByDiscordId = async (discordId) => {
  await ensureAdminSchema();
  const rows = await sql`SELECT * FROM admin_credentials WHERE discord_id = ${discordId} LIMIT 1`;
  return rows[0] || null;
};

const getAllAdmins = async () => {
  await ensureAdminSchema();
  return sql`SELECT id, pin, email, role, discord_id, updated_at FROM admin_credentials ORDER BY role, pin`;
};

const setAdminPassword = async (pin, email, hash, role = 'moderator') => {
  await ensureAdminSchema();
  await sql`
    INSERT INTO admin_credentials (pin, email, password_hash, role)
    VALUES (${pin}, ${email}, ${hash}, ${role})
    ON CONFLICT (pin) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          email = COALESCE(EXCLUDED.email, admin_credentials.email),
          role = EXCLUDED.role,
          updated_at = now()
  `;
};

const mapProject = (p) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  description: p.description,
  longDescription: p.long_description,
  imageUrl: p.image_url,
  category: p.category,
  technologies: p.technologies,
  features: p.features,
  highlights: p.highlights,
  liveUrl: p.live_url,
  githubUrl: p.github_url,
  status: p.status,
  authorName: p.author_name,
  authorAvatar: p.author_avatar,
  architecture: p.architecture,
  timeline: p.timeline,
  teamSize: p.team_size,
  userCount: p.user_count,
  isActive: p.is_active,
  sortOrder: p.sort_order,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});

function buildAdminRouter() {
  const router = express.Router();

  const requireAuth = (req, res, next) => {
    if (req.session?.isAdminLoggedIn) return next();
    res.status(401).json({ message: 'Authentication required' });
  };

  const requireRole = (requiredRole) => (req, res, next) => {
    if (!req.session?.isAdminLoggedIn) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const level = ROLE_HIERARCHY.indexOf(req.session.adminRole);
    if (level < 0 || level < ROLE_HIERARCHY.indexOf(requiredRole)) {
      return res.status(403).json({ message: 'Insufficient permissions for this operation' });
    }
    next();
  };

  router.post('/api/admin/login', async (req, res) => {
    const { pin, password } = req.body || {};
    if (!pin || !password) return res.status(400).json({ message: 'PIN and password are required' });

    try {
      await ensureAdminSchema();
      const admin = await getAdminByPin(pin);
      if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
        return res.status(401).json({ message: 'Invalid PIN or password' });
      }

      // Rotate the session id on privilege change to avoid session fixation.
      req.session.regenerate((regenerateError) => {
        if (regenerateError) return res.status(500).json({ message: 'Session save failed' });

        req.session.isAdminLoggedIn = true;
        req.session.adminId = admin.id;
        req.session.adminRole = admin.role;

        req.session.save((saveError) => {
          if (saveError) return res.status(500).json({ message: 'Session save failed' });
          res.json({ success: true, role: admin.role, message: 'Login successful' });
        });
      });
    } catch (error) {
      console.error('Admin login error:', error);
      res.status(500).json({ message: describeDbError(error) });
    }
  });

  router.post('/api/admin/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('projecthub.sid');
      res.json({ success: true });
    });
  });

  router.get('/api/admin/current-role', requireAuth, (req, res) => {
    res.json({ role: req.session.adminRole || 'moderator' });
  });

  router.get('/api/admin/stats', requireAuth, async (_req, res) => {
    try {
      const [users] = await sql`SELECT COUNT(*)::int AS n FROM users`;
      const [requests] = await sql`SELECT COUNT(*)::int AS n FROM project_requests`;
      const [pending] = await sql`SELECT COUNT(*)::int AS n FROM project_requests WHERE status = 'pending'`;
      const [blocked] = await sql`SELECT COUNT(*)::int AS n FROM users WHERE is_blocked = true`;
      res.json({
        totalUsers: users.n,
        totalRequests: requests.n,
        pendingRequests: pending.n,
        blockedUsers: blocked.n,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ message: 'Failed to fetch statistics' });
    }
  });

  router.get('/api/admin/list', requireAuth, async (_req, res) => {
    try {
      const admins = await getAllAdmins();
      res.json(admins.map((a) => ({
        id: a.id,
        pin: a.pin,
        email: a.email,
        role: a.role,
        discordId: a.discord_id || null,
        updatedAt: a.updated_at,
      })));
    } catch (error) {
      console.error('Error fetching admins:', error);
      res.status(500).json({ message: 'Failed to fetch admins' });
    }
  });

  router.post('/api/admin/create', requireRole('admin'), async (req, res) => {
    const { pin, email, password, role } = req.body || {};
    if (!pin || !password) return res.status(400).json({ message: 'PIN and password are required' });

    const finalRole = role || 'moderator';
    if (req.session.adminRole === 'admin' && finalRole !== 'moderator') {
      return res.status(403).json({ message: 'Admins can only create moderators' });
    }

    try {
      await ensureAdminSchema();
      if (await getAdminByPin(pin)) return res.status(400).json({ message: 'PIN already exists' });
      await setAdminPassword(pin, email || null, await bcrypt.hash(password, 10), finalRole);
      res.json({ success: true, message: 'Admin created successfully' });
    } catch (error) {
      console.error('Admin creation error:', error);
      res.status(500).json({ message: 'Failed to create admin' });
    }
  });

  router.put('/api/admin/:id/role', requireRole('owner'), async (req, res) => {
    const { id } = req.params;
    const { role } = req.body || {};
    if (!ROLE_HIERARCHY.includes(role)) return res.status(400).json({ message: 'Invalid role' });
    if (id === req.session.adminId && role !== 'owner') {
      return res.status(400).json({ message: 'Cannot change your own role' });
    }

    try {
      await sql`UPDATE admin_credentials SET role = ${role} WHERE id = ${id}::uuid`;
      res.json({ success: true, message: 'Role updated successfully' });
    } catch (error) {
      console.error('Role update error:', error);
      res.status(500).json({ message: 'Failed to update role' });
    }
  });

  router.delete('/api/admin/:id', requireRole('admin'), async (req, res) => {
    const { id } = req.params;
    if (id === req.session.adminId) return res.status(400).json({ message: 'Cannot delete your own account' });

    try {
      const rows = await sql`SELECT role FROM admin_credentials WHERE id = ${id}::uuid`;
      if (rows[0]?.role === 'owner' && req.session.adminRole !== 'owner') {
        return res.status(403).json({ message: 'Only owners can delete other owners' });
      }
      await sql`DELETE FROM admin_credentials WHERE id = ${id}::uuid`;
      // When the mailbox is on its own database the ON DELETE CASCADE on the
      // mail tables cannot fire, so the admin's mail rows are removed here
      // instead. On a shared database this is a no-op.
      try {
        await purgeAdminMailData(id);
      } catch (error) {
        console.error('Admin mail cleanup failed:', error.message);
      }
      res.json({ success: true, message: 'Admin deleted successfully' });
    } catch (error) {
      console.error('Admin deletion error:', error);
      res.status(500).json({ message: 'Failed to delete admin' });
    }
  });

  router.post('/api/admin/change-password', requireAuth, async (req, res) => {
    const { id, currentPin, newPassword } = req.body || {};
    if (!id || !currentPin || !newPassword) {
      return res.status(400).json({ message: 'ID, current PIN and new password are required' });
    }
    if (id !== req.session.adminId && req.session.adminRole !== 'owner') {
      return res.status(403).json({ message: "Only owners can change other administrators' passwords" });
    }

    try {
      const target = await getAdminByPin(currentPin);
      if (!target || target.id !== id) return res.status(400).json({ message: 'Invalid current PIN' });

      await sql`
        UPDATE admin_credentials
        SET password_hash = ${await bcrypt.hash(newPassword, 10)}, updated_at = now()
        WHERE id = ${id}::uuid
      `;
      res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
      console.error('Password change error:', error);
      res.status(500).json({ message: 'Failed to change password' });
    }
  });

  /* -------------------------------------------------------------------------
     Discord sign-in for administrators.

     Separate from the public client flow: it authenticates an
     `admin_credentials` row (not a `users` row) and then establishes the same
     dashboard session a PIN/password login does. The two identities share
     nothing, so a public Discord account can never reach /pbad.
  ------------------------------------------------------------------------- */

  const adminDiscordRedirectUri = () =>
    process.env.DISCORD_ADMIN_CALLBACK_URL ||
    (process.env.APP_ORIGIN ? `${process.env.APP_ORIGIN}/api/admin/auth/discord/callback` : '');

  const isAbsoluteRedirect = (uri) => /^https?:\/\/[^/]+/i.test(uri || '');

  /** Signs the OAuth state with SESSION_SECRET so the callback can trust it. */
  const signAdminState = (value) =>
    `${Buffer.from(value).toString('base64url')}.${crypto
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update(Buffer.from(value).toString('base64url'))
      .digest('base64url')}`;

  const readAdminState = (token) => {
    if (!token || typeof token !== 'string') return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = crypto
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (typeof parsed?.exp !== 'number' || Date.now() > parsed.exp) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  router.get('/api/admin/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) {
      return res.redirect('/pbad/login?discord=error&reason=not_configured');
    }
    const redirectUri = adminDiscordRedirectUri();
    if (!isAbsoluteRedirect(redirectUri)) {
      return res.redirect('/pbad/login?discord=error&reason=redirect_not_configured');
    }

    // `mode=link` starts the same handshake from the signed-in settings page.
    // The admin id is baked into the signed state so the callback attaches the
    // Discord identity to the account that initiated it.
    const linking = req.query?.mode === 'link';
    if (linking && !req.session?.isAdminLoggedIn) {
      return res.redirect('/pbad/login?discord=error&reason=link_not_authenticated');
    }

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = signAdminState(JSON.stringify({
      t: Date.now(),
      exp: Date.now() + 600000,
      ...(linking ? { mode: 'link', adminId: req.session.adminId } : {}),
    }));

    res.cookie('admin_discord_verifier', verifier, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 600000,
      path: '/',
    });
    res.cookie('admin_discord_state', state, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 600000,
      path: '/',
    });

    const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'identify');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    return res.redirect(authorizeUrl.toString());
  });

  router.get('/api/admin/auth/discord/callback', async (req, res) => {
    const fail = (reason) => res.redirect(`/pbad/login?discord=error&reason=${encodeURIComponent(reason)}`);

    const cookies = parseCookies(req.headers.cookie || '');
    const { code, state: queryState } = req.query;
    const state = queryState || cookies.admin_discord_state;
    const verifier = cookies.admin_discord_verifier;
    const stateData = readAdminState(state);

    if (!code) return fail('missing_code');
    if (!stateData) return fail('invalid_state');
    if (!verifier) return fail('missing_verifier');

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail('not_configured');

    try {
      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: adminDiscordRedirectUri(),
          code_verifier: verifier,
        }),
      });
      if (!tokenRes.ok) return fail('token_exchange');
      const { access_token: accessToken } = await tokenRes.json();

      const profileRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!profileRes.ok) return fail('profile');
      const profile = await profileRes.json();

      res.clearCookie('admin_discord_verifier', { path: '/' });
      res.clearCookie('admin_discord_state', { path: '/' });

      if (stateData.mode === 'link') {
        // The signed state names the initiating admin; the caller must still be
        // that admin, proved by their dashboard session.
        if (!req.session?.isAdminLoggedIn || req.session.adminId !== stateData.adminId) {
          return fail('link_not_authenticated');
        }
        const owner = await getAdminByDiscordId(profile.id);
        if (owner && owner.id !== stateData.adminId) {
          return fail('discord_already_linked');
        }
        await sql`UPDATE admin_credentials SET discord_id = ${profile.id}, updated_at = now() WHERE id = ${stateData.adminId}::uuid`;
        return res.redirect('/pbad/settings?discord=linked');
      }

      const admin = await getAdminByDiscordId(profile.id);
      if (!admin) {
        // Only an administrator who has previously linked their Discord id may
        // sign in this way. An unknown Discord account is refused rather than
        // being allowed to claim an admin row by email.
        return fail('admin_not_linked');
      }

      req.session.regenerate((regenerateError) => {
        if (regenerateError) return fail('session');
        req.session.isAdminLoggedIn = true;
        req.session.adminId = admin.id;
        req.session.adminRole = admin.role;
        req.session.save((saveError) => {
          if (saveError) return fail('session');
          res.redirect('/pbad');
        });
      });
    } catch (error) {
      console.error('Admin Discord callback error:', error.message);
      return fail('unexpected');
    }
  });

  // Unlink Discord from the signed-in administrator's own row. Linking is only
  // ever done through the OAuth callback, which proves ownership of the Discord
  // identity rather than trusting an id the client supplies.
  router.delete('/api/admin/auth/discord/link', requireAuth, async (req, res) => {
    try {
      await sql`UPDATE admin_credentials SET discord_id = NULL, updated_at = now() WHERE id = ${req.session.adminId}::uuid`;
      res.json({ success: true, message: 'Discord unlinked' });
    } catch (error) {
      console.error('Admin Discord unlink error:', error);
      res.status(500).json({ message: 'Failed to unlink Discord' });
    }
  });

  // The administrator's own account, so the settings form knows what is linked.
  router.get('/api/admin/me', requireAuth, async (req, res) => {
    try {
      const rows = await sql`SELECT id, pin, email, role, discord_id FROM admin_credentials WHERE id = ${req.session.adminId}::uuid LIMIT 1`;
      const admin = rows[0];
      if (!admin) return res.status(401).json({ message: 'Authentication required' });
      res.json({
        id: admin.id,
        pin: admin.pin,
        email: admin.email,
        role: admin.role,
        discordId: admin.discord_id || null,
      });
    } catch (error) {
      console.error('Admin me error:', error);
      res.status(500).json({ message: 'Failed to fetch admin' });
    }
  });

  router.get('/api/admin/users', requireRole('moderator'), async (_req, res) => {
    try {
      const rows = await sql`
        SELECT id, email, first_name, last_name, profile_image_url, username,
               is_blocked, created_at
        FROM users
        ORDER BY created_at DESC
      `;
      res.json(rows.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        profileImageUrl: u.profile_image_url,
        username: u.username,
        isBlocked: u.is_blocked,
        createdAt: u.created_at,
      })));
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ message: 'Failed to fetch users' });
    }
  });

  router.post('/api/admin/users/:id/toggle-block', requireRole('moderator'), async (req, res) => {
    try {
      const rows = await sql`
        UPDATE users SET is_blocked = NOT is_blocked, updated_at = now()
        WHERE id = ${req.params.id}::uuid
        RETURNING id, email, first_name, last_name, profile_image_url, username, is_blocked, created_at
      `;
      if (!rows[0]) return res.status(404).json({ message: 'User not found' });
      const u = rows[0];
      res.json({
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        profileImageUrl: u.profile_image_url,
        username: u.username,
        isBlocked: u.is_blocked,
        createdAt: u.created_at,
      });
    } catch (error) {
      console.error('Toggle user block error:', error);
      res.status(500).json({ message: 'Failed to update user' });
    }
  });

  router.delete('/api/admin/users/:id', requireRole('admin'), async (req, res) => {
    try {
      await sql`DELETE FROM users WHERE id = ${req.params.id}::uuid`;
      res.json({ success: true, message: 'User deleted' });
    } catch (error) {
      console.error('User deletion error:', error);
      res.status(500).json({ message: 'Failed to delete user' });
    }
  });

  router.get('/api/admin/project-requests', requireRole('moderator'), async (_req, res) => {
    try {
      const rows = await sql`SELECT * FROM project_requests ORDER BY created_at DESC`;
      res.json(rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        title: r.title,
        description: r.description,
        budget: r.budget,
        timeline: r.timeline,
        technologies: r.technologies,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })));
    } catch (error) {
      console.error('Error fetching project requests:', error);
      res.status(500).json({ message: 'Failed to fetch project requests' });
    }
  });

  router.patch('/api/admin/project-requests/:id/status', requireRole('moderator'), async (req, res) => {
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ message: 'Status is required' });

    try {
      const rows = await sql`
        UPDATE project_requests
        SET status = ${status}::project_request_status, updated_at = now()
        WHERE id = ${req.params.id}::uuid
        RETURNING *
      `;
      if (!rows[0]) return res.status(404).json({ message: 'Project request not found' });
      res.json(rows[0]);
    } catch (error) {
      console.error('Status update error:', error);
      res.status(500).json({ message: error.message || 'Failed to update status' });
    }
  });

  router.delete('/api/admin/project-requests/:id', requireRole('admin'), async (req, res) => {
    try {
      await sql`DELETE FROM project_requests WHERE id = ${req.params.id}::uuid`;
      res.json({ message: 'Project deleted' });
    } catch (error) {
      console.error('Project deletion error:', error);
      res.status(500).json({ message: 'Failed to delete project' });
    }
  });

  router.get('/api/admin/verified-projects', requireAuth, async (_req, res) => {
    try {
      const rows = await sql`SELECT * FROM verified_projects ORDER BY sort_order, created_at`;
      res.json(rows.map(mapProject));
    } catch (error) {
      console.error('Error fetching verified projects:', error);
      res.status(500).json({ message: 'Failed to fetch verified projects' });
    }
  });

  // Drops undefined keys so a partial update only rewrites the fields the
  // dashboard actually sent; postgres.js rejects undefined parameter values.
  const toColumns = (data) => {
    const columns = {
      slug: data.slug,
      title: data.title,
      description: data.description,
      long_description: data.longDescription ?? data.long_description,
      image_url: data.imageUrl ?? data.image_url,
      category: data.category,
      technologies: data.technologies,
      features: data.features,
      highlights: data.highlights,
      live_url: data.liveUrl ?? data.live_url,
      github_url: data.githubUrl ?? data.github_url,
      status: data.status,
      author_name: data.authorName ?? data.author_name,
      author_avatar: data.authorAvatar ?? data.author_avatar,
      architecture: data.architecture,
      timeline: data.timeline,
      team_size: data.teamSize ?? data.team_size,
      user_count: data.userCount ?? data.user_count,
      is_active: data.isActive ?? data.is_active,
      sort_order: data.sortOrder ?? data.sort_order,
    };
    return Object.fromEntries(
      Object.entries(columns).filter(([, value]) => value !== undefined),
    );
  };

  router.post('/api/admin/verified-projects', requireRole('moderator'), async (req, res) => {
    try {
      const cols = toColumns(req.body || {});
      if (cols.is_active === undefined) cols.is_active = true;
      if (cols.sort_order === undefined) cols.sort_order = 0;
      const rows = await sql`INSERT INTO verified_projects ${sql(cols)} RETURNING *`;
      res.status(201).json(mapProject(rows[0]));
    } catch (error) {
      console.error('Error creating verified project:', error);
      res.status(500).json({ message: error.message || 'Failed to create project' });
    }
  });

  router.put('/api/admin/verified-projects/:id', requireRole('moderator'), async (req, res) => {
    try {
      const cols = toColumns(req.body || {});
      if (Object.keys(cols).length === 0) {
        return res.status(400).json({ message: 'No fields to update' });
      }
      const rows = await sql`
        UPDATE verified_projects SET ${sql(cols)}, updated_at = now()
        WHERE id = ${req.params.id}::uuid
        RETURNING *
      `;
      if (!rows[0]) return res.status(404).json({ message: 'Project not found' });
      res.json(mapProject(rows[0]));
    } catch (error) {
      console.error('Error updating verified project:', error);
      res.status(500).json({ message: error.message || 'Failed to update project' });
    }
  });

  router.delete('/api/admin/verified-projects/:id', requireRole('admin'), async (req, res) => {
    try {
      await sql`DELETE FROM verified_projects WHERE id = ${req.params.id}::uuid`;
      res.json({ message: 'Project deleted' });
    } catch (error) {
      console.error('Error deleting verified project:', error);
      res.status(500).json({ message: 'Failed to delete project' });
    }
  });

  router.post('/api/admin/upload', requireRole('moderator'), upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No image file provided' });
    res.json({ url: `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` });
  });

  // The ProjectHub Mail workspace. Owner/admin only — a moderator is refused by
  // `requireRole('admin')` inside the router, and every route requires a session.
  router.use(buildMailRouter({
    requireAuth,
    requireRole,
    adminIdFrom: (req) => req.session?.adminId,
  }));

  // The Discord bot configuration. Owner/admin only, same as mail: this page
  // can point the bot at a channel and trigger a real alert.
  router.use(buildBotRouter({ requireAuth, requireRole }));

  // The test-runner console. Owner only: it is the one route that starts a
  // process, so it is held to the tighter role the admin-management routes use.
  router.use(buildTestRouter({ requireAuth, requireRole }));

  router.use('/api/admin', (_req, res) => res.status(404).json({ message: 'Admin endpoint not found' }));

  return router;
}

/**
 * Inbound mail webhook.
 *
 * Resend (and Mailjet's inbound parser) can POST a received message here so it
 * lands in the Admin Mail inbox. This endpoint is public by necessity — the
 * provider calls it — so it authenticates the caller instead of the user:
 *
 *   - `MAIL_INBOUND_WEBHOOK_SECRET` must be set, otherwise the endpoint is
 *     disabled outright rather than silently accepting anything.
 *   - The secret is compared in constant time to the value in the
 *     `x-mail-webhook-secret` header, or to Resend's `svix-signature`-style
 *     shared value when configured that way.
 *   - Delivery is idempotent, so a provider retry cannot duplicate a message.
 *
 * The raw body is never trusted: it is parsed defensively and stored raw, and
 * the dashboard sanitises it at render time.
 */
async function handleInboundWebhook(req, res) {
  const expected = process.env.MAIL_INBOUND_WEBHOOK_SECRET;
  if (!expected) {
    // Refusing is the safe default: an unauthenticated inbox-write endpoint on a
    // public deployment would let anyone inject mail into the dashboard.
    return res.status(503).json({ message: 'Inbound mail webhook is not configured' });
  }

  const provided = String(
    req.headers['x-mail-webhook-secret'] ||
    req.headers['x-webhook-secret'] ||
    req.query?.secret ||
    '',
  );

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.warn('Inbound mail webhook rejected: bad secret');
    return res.status(401).json({ message: 'Invalid webhook signature' });
  }

  try {
    const payload = req.body || {};

    // Resend wraps the event in `data`; accept both shapes so the same endpoint
    // works for a raw message or an event envelope.
    const event = payload.data && payload.type ? payload.data : payload;
    const type = payload.type || 'email.received';

    if (type !== 'email.received' && type !== 'inbound' && !event.subject) {
      // A non-inbound event (delivery receipt, bounce) is acknowledged so the
      // provider does not retry, but nothing is written to the inbox.
      return res.json({ success: true, ignored: type });
    }

    const result = await handleInboundMessage(event);
    if (result.duplicate) return res.json({ success: true, duplicate: true, id: result.id });

    // Notify every admin except the actor (there is no actor for inbound mail).
    await createMailNotifications({
      type: 'new_email',
      title: event.subject || 'New email',
      preview: event.text || event.html || '',
      messageId: result.id,
      threadId: result.threadId,
    });

    res.json({ success: true, id: result.id, threadId: result.threadId });
  } catch (error) {
    console.error('Inbound mail webhook error:', error);
    // A 500 lets the provider retry; the idempotency key makes that safe.
    res.status(500).json({ message: 'Failed to process inbound message' });
  }
}

function buildAdminApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Never fall back to a literal secret. The previous default
  // ('fallback-secret-key-for-vercel') is in this public repository, so any
  // deployment that started without SESSION_SECRET let anyone who had read the
  // source forge an admin session cookie and sign in with no PIN.
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET must be set for the admin dashboard');
  }

  const PgSession = connectPgSimple(session);
  app.use(session({
    store: new PgSession({
      conString: normalizeDatabaseUrl(process.env.DATABASE_URL),
      tableName: 'admin_sessions',
      createTableIfMissing: true,
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    name: 'projecthub.sid',
    cookie: {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    },
  }));

  // Inbound provider webhook. Registered before the admin router because it is
  // called by Resend, not by an administrator, so it authenticates with its own
  // shared secret instead of the dashboard session.
  app.post('/api/admin/mail/inbound', handleInboundWebhook);

  const router = buildAdminRouter();
  // The rewrite may hand us either the full path or one with the /api/admin
  // prefix already stripped, so accept both shapes.
  app.use('/', router);
  app.use('/api/admin', router);

  return app;
}

const app = buildAdminApp();

export default async function handler(request, response) {
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return response.status(204).end();
  }

  try {
    return app(request, response);
  } catch (error) {
    console.error('Admin API handler error:', error);
    if (!response.headersSent) {
      return response.status(500).json({ message: 'Internal server error' });
    }
  }
}