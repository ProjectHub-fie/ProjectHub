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
import { describeDbError, normalizeDatabaseUrl } from '../lib/db.js';

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
 * Mirrors the auto-seed convention already used by api/lib/storage.js, so the
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
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `;
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

const getAllAdmins = async () => {
  await ensureAdminSchema();
  return sql`SELECT id, pin, email, role, updated_at FROM admin_credentials ORDER BY role, pin`;
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

  router.use('/api/admin', (_req, res) => res.status(404).json({ message: 'Admin endpoint not found' }));

  return router;
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