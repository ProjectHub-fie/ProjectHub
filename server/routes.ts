import type { Express } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import bcrypt from "bcryptjs";
import { storage } from "./storage.js";
import passport from "./auth.js";
import { insertProjectRequestSchema } from "./../shared/schema.js";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";

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

export async function registerRoutes(app: Express): Promise<Server> {
  // Trust proxy for Vercel
  app.set('trust proxy', 1);

  // Session configuration with improved Vercel compatibility
  const PgSession = connectPgSimple(session);
  const pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  // Determine if we're in production/Vercel environment
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  const cookieDomain = isProduction ? undefined : undefined; // Let browser handle domain
  
  app.use(session({
    store: new PgSession({
      pool: pgPool,
      tableName: 'sessions',
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || 'fallback-secret-key-for-development-only-do-not-use-in-production',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    name: 'projecthub.sid', // Custom session cookie name
    cookie: {
      secure: isProduction, // Only secure in production
      sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-origin in production
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      domain: cookieDomain,
      path: '/'
    }
  }));

  // Initialize passport
  app.use(passport.initialize());
  app.use(passport.session());

  // Enhanced error logging
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Session error:', err);
    next(err);
  });

  // Auth routes
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, firstName, lastName, captchaToken } = req.body;

      // Validate required fields
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: "All fields are required" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Create user
      const user = await storage.upsertUser({
        email,
        password: hashedPassword,
        firstName,
        lastName
      });

      // Log user in automatically after registration
      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error('Auto-login after registration failed:', loginErr);
          return res.status(201).json({ 
            message: "Registration successful", 
            user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } 
          });
        }
        res.status(201).json({ 
          user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } 
        });
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post('/api/auth/login', (req, res, next) => {
    const { captchaToken } = req.body;
    
    // Validate captcha before proceeding to passport
    if (captchaToken) {
      const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
      if (turnstileSecret) {
        fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `secret=${turnstileSecret}&response=${captchaToken}`
        })
        .then(res => res.json())
        .then((verifyData: any) => {
          if (!verifyData.success) {
            console.error('Turnstile verification failed:', verifyData);
            return res.status(400).json({ message: "Security verification failed" });
          }
          
          passport.authenticate('local', (err: any, user: any, info: any) => {
            if (err) {
              return res.status(500).json({ message: "Login failed" });
            }
            if (!user) {
              return res.status(401).json({ message: info?.message || "Invalid email or password" });
            }

            req.login(user, (loginErr) => {
              if (loginErr) {
                return res.status(500).json({ message: "Login failed" });
              }
              res.json({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } });
            });
          })(req, res, next);
        })
        .catch(err => {
          console.error('hCaptcha error:', err);
          res.status(500).json({ message: "Security verification failed" });
        });
        return;
      }
    }

    passport.authenticate('local', (err: any, user: any, info: any) => {
      if (err) {
        console.error('Passport auth error:', err);
        return res.status(500).json({ message: "Login failed" });
      }
      if (!user) {
        console.log('Passport auth failed - no user:', info?.message);
        return res.status(401).json({ message: info?.message || "Invalid email or password" });
      }

      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error('req.login error:', loginErr);
          return res.status(500).json({ message: "Login failed" });
        }
        res.json({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } });
      });
    })(req, res, next);
  });

  app.post('/api/auth/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ message: "Logout failed" });
      }
      // Clear session cookie
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error('Session destroy error:', destroyErr);
        }
        res.clearCookie('projecthub.sid');
        res.json({ message: "Logged out successfully" });
      });
    });
  });

  // Profile routes
  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  app.patch('/api/auth/user', requireAuth, async (req, res) => {
    try {
      const { firstName, lastName, profileImageUrl } = req.body;
      const userId = (req.user as Express.User)?.id;

      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const updatedUser = await storage.upsertUser({
        id: userId,
        firstName,
        lastName,
        profileImageUrl
      });

      res.json({ user: updatedUser });
    } catch (error) {
      console.error('Profile update error:', error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Project request routes
  app.post('/api/project-requests', requireAuth, async (req, res) => {
    try {
      const validatedData = insertProjectRequestSchema.parse({
        ...req.body,
        userId: (req.user as Express.User)?.id
      });

      const projectRequest = await storage.createProjectRequest(validatedData);
      res.status(201).json(projectRequest);
    } catch (error: any) {
      console.error('Project request error:', error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create project request" });
    }
  });

  app.get('/api/project-requests', requireAuth, async (req, res) => {
    try {
      const userId = (req.user as Express.User)?.id;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const requests = await storage.getProjectRequests(userId);
      res.json(requests);
    } catch (error) {
      console.error('Get project requests error:', error);
      res.status(500).json({ message: "Failed to fetch project requests" });
    }
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        VERCEL: !!process.env.VERCEL,
        HAS_DATABASE_URL: !!process.env.DATABASE_URL,
        HAS_SESSION_SECRET: !!process.env.SESSION_SECRET,
      }
    });
  });

  // Debug endpoint for development
  if (process.env.NODE_ENV === 'development') {
    app.get('/api/debug/env', (req, res) => {
      res.json({
        DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT_SET',
        SESSION_SECRET: process.env.SESSION_SECRET ? 'SET' : 'NOT_SET',
        RESEND_API_KEY: process.env.RESEND_API_KEY ? 'SET' : 'NOT_SET',
        TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ? 'SET' : 'NOT_SET',
        DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID ? 'SET' : 'NOT_SET',
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        VERCEL_URL: process.env.VERCEL_URL,
        NODE_ENV: process.env.NODE_ENV,
        VERCEL: process.env.VERCEL,
      });
    });
  }

  // Catch-all for undefined routes
  app.use('/api/*', (req, res) => {
    res.status(404).json({ message: 'API endpoint not found' });
  });

  return createServer(app);
}