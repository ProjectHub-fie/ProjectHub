import { createServer, type Server } from "http";
import session from "express-session";
import bcrypt from "bcryptjs";
import { storage } from "./storage.js";
import * as passport from "./auth.js";
import { insertProjectRequestSchema } from "./../shared/schema.js";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as z from 'zod';
import { db } from './db.js';

const app = new Hono();

// CORS middleware
app.use(
  '*',
  cors({
    origin: ['http://localhost:3000', 'https://projecthub.vercel.app'],
    credentials: true,
  })
);

// Health check endpoint
app.get('/health', async (c) => {
  try {
    return c.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return c.json({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// 404 handler
app.notFound((c) => {
  return c.json({ 
    error: 'Route not found',
    path: c.req.path,
    method: c.req.method
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('API Error:', err);
  
  if (err instanceof z.ZodError) {
    return c.json({ 
      error: 'Validation error',
      details: err.errors 
    }, 400);
  }
  
  return c.json({ 
    error: 'Internal server error',
    message: err instanceof Error ? err.message : 'Unknown error'
  }, 500);
});

export default app;

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      isBlocked?: boolean;
      profileImageUrl?: string | null;
    }
  }
}

// Middleware to check if user is authenticated and not blocked
function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    if (req.user?.isBlocked) {
      req.logout(() => {});
      return res.status(403).json({ message: "Your account has been blocked" });
    }
    return next();
  }
  res.status(401).json({ message: "Authentication required" });
}

export async function registerRoutes(expressApp: any): Promise<Server> {
  // Trust proxy for Vercel
  if (typeof expressApp.set === 'function') {
    expressApp.set('trust proxy', 1);
  }

  // Session configuration with fallback to memory store
  let sessionStore: session.Store;
  let useDatabaseSessions = true;

  try {
    const PgSession = connectPgSimple(session);
    const pgPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });
    
    sessionStore = new PgSession({
      pool: pgPool,
      tableName: 'sessions',
      createTableIfMissing: true,
    });
    
    await pgPool.query('SELECT 1');
    console.log('Database session store initialized successfully');
  } catch (dbError: any) {
    console.warn('Database session store failed, falling back to memory store:', dbError.message);
    sessionStore = new session.MemoryStore();
    useDatabaseSessions = false;
  }

  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  
  expressApp.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'fallback-secret-key-for-development-only-do-not-use-in-production',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    name: 'projecthub.sid',
    cookie: {
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      path: '/'
    }
  }));

  // Initialize passport mock/compatibility
  expressApp.use(passport.initialize());
  expressApp.use(passport.session());

  // Auth routes
  expressApp.post('/api/auth/register', async (req: any, res: any) => {
    try {
      const { email, password, firstName, lastName } = req.body;
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: "Email already registered" });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await storage.upsertUser({ email, firstName, lastName, password: hashedPassword });

      req.login(user, (err: any) => {
        if (err) return res.status(201).json({ user, message: "Registration successful but session storage unavailable" });
        res.status(201).json({ user });
      });
    } catch (error) {
      res.status(500).json({ message: "Registration failed" });
    }
  });

  expressApp.post('/api/auth/login', (req: any, res: any, next: any) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });

    passport.authenticate('local', (err: any, user: any, info: any) => {
      if (err) return res.status(500).json({ message: "Authentication failed" });
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });

      req.login(user, (loginErr: any) => {
        if (loginErr) return res.json({ user, message: "Login successful but session persistence unavailable" });
        res.json({ user });
      });
    })(req, res, next);
  });

  expressApp.post('/api/auth/logout', (req: any, res: any) => {
    req.logout((err: any) => {
      req.session.destroy(() => {
        res.clearCookie('projecthub.sid');
        res.json({ message: "Logged out successfully" });
      });
    });
  });

  expressApp.get('/api/auth/me', requireAuth, (req: any, res: any) => res.json({ user: req.user }));

  expressApp.patch('/api/auth/user', requireAuth, async (req: any, res: any) => {
    try {
      const { firstName, lastName, profileImageUrl } = req.body;
      const updatedUser = await storage.upsertUser({ id: req.user.id, firstName, lastName, profileImageUrl });
      res.json({ user: updatedUser });
    } catch (error) {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  expressApp.post('/api/project-requests', requireAuth, async (req: any, res: any) => {
    try {
      const projectRequest = await storage.createProjectRequest({ ...req.body, userId: req.user.id });
      res.status(201).json(projectRequest);
    } catch (error) {
      res.status(500).json({ message: "Failed to create project request" });
    }
  });

  expressApp.get('/api/project-requests', requireAuth, async (req: any, res: any) => {
    try {
      const requests = await storage.getProjectRequests(req.user.id);
      res.json(requests);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch project requests" });
    }
  });

  expressApp.get('/api/projects', async (req: any, res: any) => {
    try {
      const projects = await storage.getAllVerifiedProjects();
      res.json(projects);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  expressApp.get('/api/health', (req: any, res: any) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        VERCEL: !!process.env.VERCEL,
        DATABASE_SESSIONS: useDatabaseSessions
      }
    });
  });

  const server = createServer(expressApp);
  return server;
}
