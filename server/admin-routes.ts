import { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import { adminStorage } from "./admin-storage.js";
import { buildMailRouter, handleInboundMessage } from "../api/_lib/mail-routes.js";
import { buildBotRouter } from "../api/_lib/bot-routes.js";
import { buildTestRouter } from "../api/_lib/test-routes.js";
import { createMailNotifications } from "../api/_lib/mail-store.js";

declare module "express-session" {
  interface SessionData {
    isAdminLoggedIn?: boolean;
    adminId?: string;
    adminRole?: string;
  }
}

// In-memory uploads: the deployment targets Vercel, whose filesystem is
// ephemeral and read-only outside /tmp, so uploaded images are inlined as data
// URLs instead of being written to disk that would not survive a cold start.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});


/**
 * Registers the administration dashboard API, entirely under /api/admin.
 *
 * Keeping every dashboard endpoint inside one prefix lets the production
 * serverless router send /api/admin/* to a dedicated, session-aware function,
 * while the public API stays untouched. Each route below is gated by a session
 * that only /api/admin/login can create, otherwise the /pbad dashboard would
 * leak user and project data to the public website it shares a deployment with.
 */
export async function registerAdminRoutes(app: Express): Promise<Server> {
  app.set('trust proxy', 1);

  const requireAuth = (req: Request, res: any, next: NextFunction) => {
    if (req.session?.isAdminLoggedIn) return next();
    res.status(401).json({ message: "Authentication required" });
  };

  const requireRole = (requiredRole: string) => {
    return (req: Request, res: any, next: NextFunction) => {
      if (!req.session?.isAdminLoggedIn) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const userRole = req.session.adminRole;
      if (!userRole) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }

      const roleHierarchy = ['moderator', 'admin', 'owner'];
      const userLevel = roleHierarchy.indexOf(userRole);
      const requiredLevel = roleHierarchy.indexOf(requiredRole);

      if (userLevel < requiredLevel) {
        return res.status(403).json({ message: "Insufficient permissions for this operation" });
      }

      next();
    };
  };

  app.get('/api/admin/list', requireAuth, async (_req: Request, res: any) => {
    try {
      const admins = await adminStorage.getAllAdmins();
      res.json(admins.map((a: any) => ({
        id: a.id,
        pin: a.pin,
        email: a.email,
        role: a.role,
        discordId: a.discordId || null,
        updatedAt: a.updatedAt
      })));
    } catch (error) {
      console.error('Error fetching admins:', error);
      res.status(500).json({ message: "Failed to fetch admins" });
    }
  });

  app.post('/api/admin/create', requireRole('admin'), async (req: Request, res: any) => {
    try {
      const { pin, email, password, role } = req.body;

      if (!pin || !password) {
        return res.status(400).json({ message: "PIN and password are required" });
      }

      const finalRole = role || 'moderator';

      const creatorRole = req.session!.adminRole;
      if (creatorRole === 'admin' && finalRole !== 'moderator') {
        return res.status(403).json({ message: "Admins can only create moderators" });
      }

      const existingAdmin = await adminStorage.getAdminByPin(pin);
      if (existingAdmin) {
        return res.status(400).json({ message: "PIN already exists" });
      }

      const hash = await bcrypt.hash(password, 10);
      await adminStorage.setAdminPassword(pin, email || null, hash, finalRole);
      res.json({ success: true, message: "Admin created successfully" });
    } catch (error) {
      console.error('Admin creation error:', error);
      res.status(500).json({ message: "Failed to create admin" });
    }
  });

  app.put('/api/admin/:id/role', requireRole('owner'), async (req: Request, res: any) => {
    try {
      const { id } = req.params;
      const { role } = req.body;

      if (!['owner', 'admin', 'moderator'].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      if (id === req.session!.adminId && role !== 'owner') {
        return res.status(400).json({ message: "Cannot change your own role" });
      }

      await adminStorage.updateAdminRole(id, role);
      res.json({ success: true, message: "Role updated successfully" });
    } catch (error) {
      console.error('Role update error:', error);
      res.status(500).json({ message: "Failed to update role" });
    }
  });

  app.delete('/api/admin/:id', requireRole('admin'), async (req: Request, res: any) => {
    try {
      const { id } = req.params;

      if (id === req.session!.adminId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      const admins = await adminStorage.getAllAdmins();
      const adminToDelete = admins.find((a: any) => a.id === id);
      if (adminToDelete?.role === 'owner' && req.session!.adminRole !== 'owner') {
        return res.status(403).json({ message: "Only owners can delete other owners" });
      }

      await adminStorage.deleteAdmin(id);
      res.json({ success: true, message: "Admin deleted successfully" });
    } catch (error) {
      console.error('Admin deletion error:', error);
      res.status(500).json({ message: "Failed to delete admin" });
    }
  });

  app.post('/api/admin/login', async (req: Request, res: any) => {
    try {
      const { pin, password } = req.body;

      if (!pin || !password) {
        return res.status(400).json({ message: "PIN and password are required" });
      }

      const admin = await adminStorage.getAdminByPin(pin);
      if (!admin) {
        return res.status(401).json({ message: "Invalid PIN or password" });
      }

      const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid PIN or password" });
      }

      // Rotate the session id on privilege change to avoid session fixation.
      req.session!.regenerate((regenerateError: any) => {
        if (regenerateError) {
          return res.status(500).json({ message: "Session save failed" });
        }

        req.session!.isAdminLoggedIn = true;
        req.session!.adminId = admin.id;
        req.session!.adminRole = admin.role;

        req.session!.save((saveError: any) => {
          if (saveError) return res.status(500).json({ message: "Session save failed" });
          res.json({
            success: true,
            role: admin.role,
            message: "Login successful"
          });
        });
      });
    } catch (error) {
      console.error('Admin login error:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post('/api/admin/change-password', requireAuth, async (req: Request, res: any) => {
    try {
      const { id, currentPin, newPassword } = req.body;

      if (!id || !currentPin || !newPassword) {
        return res.status(400).json({ message: "ID, current PIN and new password are required" });
      }

      if (id !== req.session!.adminId && req.session!.adminRole !== 'owner') {
        return res.status(403).json({ message: "Only owners can change other administrators' passwords" });
      }

      const targetAdmin = await adminStorage.getAdminByPin(currentPin);
      if (!targetAdmin || targetAdmin.id !== id) {
        return res.status(400).json({ message: "Invalid current PIN" });
      }

      const hash = await bcrypt.hash(newPassword, 10);
      await adminStorage.setAdminPassword(targetAdmin.pin, targetAdmin.email, hash, targetAdmin.role);
      res.json({ success: true, message: "Password updated successfully" });
    } catch (error) {
      console.error('Password change error:', error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  app.post('/api/admin/logout', (req: Request, res: any) => {
    req.session!.destroy(() => {
      res.clearCookie('projecthub.sid');
      res.json({ success: true });
    });
  });

  app.get('/api/admin/current-role', requireAuth, async (req: Request, res: any) => {
    try {
      res.json({ role: req.session?.adminRole || 'moderator' });
    } catch (error) {
      console.error('Error fetching admin role:', error);
      res.status(500).json({ message: "Failed to fetch admin role" });
    }
  });

  /* -------------------------------------------------------------------------
     Discord sign-in for administrators (mirrors api/admin/index.js).

     It authenticates an `admin_credentials` row, never a public `users` row,
     and then establishes the same dashboard session a PIN/password login does.
  ------------------------------------------------------------------------- */
  const adminDiscordRedirectUri = () =>
    process.env.DISCORD_ADMIN_CALLBACK_URL ||
    (process.env.APP_ORIGIN ? `${process.env.APP_ORIGIN}/api/admin/auth/discord/callback` : '');

  const isAbsoluteRedirect = (uri: string) => /^https?:\/\/[^/]+/i.test(uri || '');

  const signAdminState = (value: string) => {
    const payload = Buffer.from(value).toString('base64url');
    const signature = crypto
      .createHmac('sha256', process.env.SESSION_SECRET as string)
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  };

  const readAdminState = (token: string): any => {
    if (!token || typeof token !== 'string') return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = crypto
      .createHmac('sha256', process.env.SESSION_SECRET as string)
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

  app.get('/api/admin/auth/discord', (req: Request, res: any) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) return res.redirect('/pbad/login?discord=error&reason=not_configured');

    const redirectUri = adminDiscordRedirectUri();
    if (!isAbsoluteRedirect(redirectUri)) {
      return res.redirect('/pbad/login?discord=error&reason=redirect_not_configured');
    }

    const linking = req.query?.mode === 'link';
    if (linking && !req.session?.isAdminLoggedIn) {
      return res.redirect('/pbad/login?discord=error&reason=link_not_authenticated');
    }

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = signAdminState(JSON.stringify({
      t: Date.now(),
      exp: Date.now() + 600000,
      ...(linking ? { mode: 'link', adminId: req.session!.adminId } : {}),
    }));

    res.cookie('admin_discord_verifier', verifier, {
      httpOnly: true, sameSite: 'lax', maxAge: 600000, path: '/',
    });
    res.cookie('admin_discord_state', state, {
      httpOnly: true, sameSite: 'lax', maxAge: 600000, path: '/',
    });

    const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'identify');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    res.redirect(authorizeUrl.toString());
  });

  app.get('/api/admin/auth/discord/callback', async (req: Request, res: any) => {
    const fail = (reason: string) => res.redirect(`/pbad/login?discord=error&reason=${encodeURIComponent(reason)}`);

    const { code, state: queryState } = req.query;
    const state = queryState || req.cookies?.admin_discord_state;
    const verifier = req.cookies?.admin_discord_verifier;
    const stateData = readAdminState(String(state || ''));

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
          code_verifier: String(verifier),
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
        if (!req.session?.isAdminLoggedIn || req.session.adminId !== stateData.adminId) {
          return fail('link_not_authenticated');
        }
        const owner = await adminStorage.getAdminByDiscordId(profile.id);
        if (owner && owner.id !== stateData.adminId) return fail('discord_already_linked');
        await adminStorage.setAdminDiscordId(stateData.adminId, profile.id);
        return res.redirect('/pbad/settings?discord=linked');
      }

      const admin = await adminStorage.getAdminByDiscordId(profile.id);
      // An administrator must have linked Discord first; an unknown Discord
      // account cannot claim an admin row by email.
      if (!admin) return fail('admin_not_linked');

      req.session!.regenerate((regenerateError: any) => {
        if (regenerateError) return fail('session');
        req.session!.isAdminLoggedIn = true;
        req.session!.adminId = admin.id;
        req.session!.adminRole = admin.role;
        req.session!.save((saveError: any) => {
          if (saveError) return fail('session');
          res.redirect('/pbad');
        });
      });
    } catch (error: any) {
      console.error('Admin Discord callback error:', error.message);
      return fail('unexpected');
    }
  });

  app.delete('/api/admin/auth/discord/link', requireAuth, async (req: Request, res: any) => {
    try {
      await adminStorage.setAdminDiscordId(req.session!.adminId, null);
      res.json({ success: true, message: 'Discord unlinked' });
    } catch (error) {
      console.error('Admin Discord unlink error:', error);
      res.status(500).json({ message: 'Failed to unlink Discord' });
    }
  });

  app.get('/api/admin/me', requireAuth, async (req: Request, res: any) => {
    try {
      const admins = await adminStorage.getAllAdmins();
      const admin = admins.find((a: any) => a.id === req.session!.adminId);
      if (!admin) return res.status(401).json({ message: 'Authentication required' });
      res.json({
        id: admin.id,
        pin: admin.pin,
        email: admin.email,
        role: admin.role,
        discordId: admin.discordId || null,
      });
    } catch (error) {
      console.error('Admin me error:', error);
      res.status(500).json({ message: 'Failed to fetch admin' });
    }
  });

  app.get('/api/admin/users', requireRole('moderator'), async (_req: Request, res: any) => {
    try {
      const allUsers = await adminStorage.getAllUsers();
      res.json(allUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post('/api/admin/users/:id/toggle-block', requireRole('moderator'), async (req: Request, res: any) => {
    try {
      const updatedUser = await adminStorage.toggleUserBlock(req.params.id);
      res.json(updatedUser);
    } catch (error: any) {
      console.error('Toggle user block error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete('/api/admin/users/:id', requireRole('admin'), async (req: Request, res: any) => {
    try {
      await adminStorage.deleteUser(req.params.id);
      res.json({ success: true, message: "User deleted" });
    } catch (error: any) {
      console.error('User deletion error:', error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  app.get('/api/admin/stats', requireAuth, async (_req: Request, res: any) => {
    try {
      const allUsers = await adminStorage.getAllUsers();
      const allRequests = await adminStorage.getAllProjectRequests();
      res.json({
        totalUsers: allUsers.length,
        totalRequests: allRequests.length,
        pendingRequests: allRequests.filter((r: any) => r.status === 'pending').length,
        blockedUsers: allUsers.filter((u: any) => u.isBlocked).length
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  // Admin variant of the project request list: the public site only exposes the
  // signed-in user's own requests, so administrators need their own endpoint.
  app.get('/api/admin/project-requests', requireRole('moderator'), async (_req: Request, res: any) => {
    try {
      const requests = await adminStorage.getAllProjectRequests();
      res.json(requests);
    } catch (error) {
      console.error('Error fetching project requests:', error);
      res.status(500).json({ message: "Failed to fetch project requests" });
    }
  });

  app.patch('/api/admin/project-requests/:id/status', requireRole('moderator'), async (req: Request, res: any) => {
    try {
      const { status } = req.body;
      if (!status) {
        return res.status(400).json({ message: "Status is required" });
      }

      const updated = await adminStorage.updateProjectRequestStatus(req.params.id, status);
      if (!updated) {
        return res.status(404).json({ message: "Project request not found" });
      }
      res.json(updated);
    } catch (error: any) {
      console.error('Status update error:', error);
      res.status(500).json({ message: error.message || "Failed to update status" });
    }
  });

  app.delete('/api/admin/project-requests/:id', requireRole('admin'), async (req: Request, res: any) => {
    try {
      await adminStorage.deleteProjectRequest(req.params.id);
      res.json({ message: "Project deleted" });
    } catch (error) {
      console.error('Project deletion error:', error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  app.get('/api/admin/verified-projects', requireAuth, async (_req: Request, res: any) => {
    try {
      const projects = await adminStorage.getAllVerifiedProjectsIncludingInactive();
      res.json(projects);
    } catch (error) {
      console.error('Error fetching verified projects:', error);
      res.status(500).json({ message: "Failed to fetch verified projects" });
    }
  });

  app.post('/api/admin/verified-projects', requireRole('moderator'), async (req: Request, res: any) => {
    try {
      const project = await adminStorage.createVerifiedProject(req.body);
      res.status(201).json(project);
    } catch (error: any) {
      console.error('Error creating verified project:', error);
      res.status(500).json({ message: error.message || "Failed to create project" });
    }
  });

  app.put('/api/admin/verified-projects/:id', requireRole('moderator'), async (req: Request, res: any) => {
    try {
      const updated = await adminStorage.updateVerifiedProject(req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "Project not found" });
      res.json(updated);
    } catch (error: any) {
      console.error('Error updating verified project:', error);
      res.status(500).json({ message: error.message || "Failed to update project" });
    }
  });

  app.delete('/api/admin/verified-projects/:id', requireRole('admin'), async (req: Request, res: any) => {
    try {
      await adminStorage.deleteVerifiedProject(req.params.id);
      res.json({ message: "Project deleted" });
    } catch (error) {
      console.error('Error deleting verified project:', error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  // Images are stored as data URLs because the production filesystem is
  // read-only; seeded projects keep referencing their bundled public assets.
  app.post('/api/admin/upload', requireRole('moderator'), upload.single('image'), (req: Request, res: any) => {
    if (!req.file) return res.status(400).json({ message: "No image file provided" });
    res.json({ url: `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}` });
  });

  /**
   * Inbound mail webhook, mirroring api/admin/index.js.
   *
   * Registered before the mail router because the provider — not an
   * administrator — calls it, so it authenticates with its own shared secret.
   */
  app.post('/api/admin/mail/inbound', async (req: Request, res: any) => {
    const expected = process.env.MAIL_INBOUND_WEBHOOK_SECRET;
    if (!expected) {
      return res.status(503).json({ message: 'Inbound mail webhook is not configured' });
    }

    const provided = String(
      req.headers['x-mail-webhook-secret'] || req.headers['x-webhook-secret'] || req.query?.secret || '',
    );
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('Inbound mail webhook rejected: bad secret');
      return res.status(401).json({ message: 'Invalid webhook signature' });
    }

    try {
      const payload = req.body || {};
      const event = payload.data && payload.type ? payload.data : payload;
      const type = payload.type || 'email.received';
      if (type !== 'email.received' && type !== 'inbound' && !event.subject) {
        return res.json({ success: true, ignored: type });
      }

      const result = await handleInboundMessage(event);
      if (result.duplicate) return res.json({ success: true, duplicate: true, id: result.id });

      await createMailNotifications({
        type: 'new_email',
        title: event.subject || 'New email',
        preview: event.text || event.html || '',
        messageId: result.id,
        threadId: result.threadId,
      });

      res.json({ success: true, id: result.id, threadId: result.threadId });
    } catch (error: any) {
      console.error('Inbound mail webhook error:', error);
      res.status(500).json({ message: 'Failed to process inbound message' });
    }
  });

  // The ProjectHub Mail workspace (owner/admin only), shared with the serverless
  // function so both backends expose exactly the same routes.
  app.use(buildMailRouter({
    requireAuth,
    requireRole,
    adminIdFrom: (req: Request) => req.session?.adminId,
  }));

  // The Discord bot configuration, same guards and same shared router as the
  // serverless dashboard function.
  app.use(buildBotRouter({ requireAuth, requireRole }));

  // The test-runner console, owner only, shared with the serverless backend.
  app.use(buildTestRouter({ requireAuth, requireRole }));

  return createServer(app);
}