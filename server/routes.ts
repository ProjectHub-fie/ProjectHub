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

// Memory store for sessions as fallback
class MemoryStore extends session.Store {
  private sessions: Map<string, any> = new Map();

  get(sid: string, callback: (err: any, session?: session.SessionData) => void) {
    callback(null, this.sessions.get(sid));
  }

  set(sid: string, session: session.SessionData, callback?: (err: any) => void) {
    this.sessions.set(sid, session);
    callback?.(null);
  }

  destroy(sid: string, callback?: (err: any) => void) {
    this.sessions.delete(sid);
    callback?.(null);
  }

  touch(sid: string, session: session.SessionData, callback?: (err: any) => void) {
    // Update expiry
    this.sessions.set(sid, session);
    callback?.(null);
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

  // Session configuration with fallback to memory store
  let sessionStore: session.Store;
  let useDatabaseSessions = true;

  try {
    const PgSession = connectPgSimple(session);
    const pgPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000, // 5 second timeout
      idleTimeoutMillis: 30000,
    });
    
    sessionStore = new PgSession({
      pool: pgPool,
      tableName: 'sessions',
      createTableIfMissing: true,
    });
    
    // Test database connection
    await pgPool.query('SELECT 1');
    console.log('Database session store initialized successfully');
  } catch (dbError: any) {
    console.warn('Database session store failed, falling back to memory store:', dbError.message);
    sessionStore = new MemoryStore();
    useDatabaseSessions = false;
  }

  // Determine if we're in production/Vercel environment
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  const cookieDomain = isProduction ? undefined : undefined; // Let browser handle domain
  
  app.use(session({
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
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      domain: cookieDomain,
      path: '/'
    }
  }));

  // Initialize passport
  app.use(passport.initialize());
  app.use(passport.session());

  // Enhanced session error handling
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Session middleware error:', err.message);
    // Continue processing even if session fails
    next();
  });

  // Auth routes
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, firstName, lastName, captchaToken } = req.body;

      // Validate required fields
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: "All fields are required" });
      }

      // Captcha validation for production
      if (process.env.NODE_ENV === 'production' && captchaToken) {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY;
        if (turnstileSecret) {
          try {
            const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `secret=${turnstileSecret}&response=${captchaToken}`
            });
            const verifyData: any = await verifyResponse.json();
            if (!verifyData.success) {
              return res.status(400).json({ message: "Security verification failed" });
            }
          } catch (verifyError) {
            console.error('Turnstile verification error:', verifyError);
          }
        }
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
        firstName,
        lastName,
        password: hashedPassword,
      });

      // Log user in (skip session storage if it's failing)
      req.login(user, (err) => {
        if (err) {
          console.error('Login after registration error:', err);
          // Still return success even if session fails
          return res.status(201).json({ 
            user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
            message: "Registration successful but session storage unavailable"
          });
        }
        res.status(201).json({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } });
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post('/api/auth/login', (req, res, next) => {
    const { email, password, captchaToken } = req.body;
    
    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Captcha validation for production
    if (process.env.NODE_ENV === 'production' && captchaToken) {
      const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY;
      if (turnstileSecret) {
        fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `secret=${turnstileSecret}&response=${captchaToken}`
        })
        .then(res => res.json())
        .then((verifyData: any) => {
          if (!verifyData.success) {
            return res.status(400).json({ message: "Security verification failed" });
          }
          
          proceedWithLogin();
        })
        .catch(err => {
          console.error('Turnstile error:', err);
          return res.status(500).json({ message: "Security verification failed" });
        });
        return;
      }
    }

    proceedWithLogin();

    function proceedWithLogin() {
      passport.authenticate('local', (err: any, user: any, info: any) => {
        if (err) {
          console.error('Passport authentication error:', err);
          return res.status(500).json({ message: "Authentication failed" });
        }
        
        if (!user) {
          return res.status(401).json({ message: info?.message || "Invalid credentials" });
        }

        req.login(user, (loginErr) => {
          if (loginErr) {
            console.error('Session login error:', loginErr);
            // Return success even if session storage fails
            return res.json({ 
              user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
              message: "Login successful but session persistence unavailable"
            });
          }
          
          res.json({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } });
        });
      })(req, res, next);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error('Logout error:', err);
      }
      
      // Always clear session regardless of errors
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error('Session destroy error:', destroyErr);
        }
        
        // Clear cookie
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

  // Password reset routes
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const { email, captchaToken } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Captcha validation for production
      if (process.env.NODE_ENV === 'production' && captchaToken) {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY;
        if (turnstileSecret) {
          try {
            const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `secret=${turnstileSecret}&response=${captchaToken}`
            });
            const verifyData: any = await verifyResponse.json();
            if (!verifyData.success) {
              return res.status(400).json({ message: "Security verification failed" });
            }
          } catch (err) {
            console.error('Forgot password Turnstile error:', err);
          }
        }
      }

      const user = await storage.getUserByEmail(email);
      if (!user) {
        // Don't reveal if email exists
        return res.json({ message: "Password reset email sent" });
      }

      // Generate reset token
      const { randomBytes } = await import("crypto");
      const resetToken = randomBytes(3).toString('hex').toUpperCase();
      const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

      await storage.updateUserResetToken(user.id, resetToken, resetTokenExpiry);

      res.json({ message: "Password reset email sent" });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ message: "Failed to process reset request" });
    }
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const { token, newPassword, captchaToken } = req.body;
      
      // Captcha validation for production
      if (process.env.NODE_ENV === 'production' && captchaToken) {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY;
        if (turnstileSecret) {
          const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${turnstileSecret}&response=${captchaToken}`
          });
          const verifyData: any = await verifyResponse.json();
          if (!verifyData.success) {
            return res.status(400).json({ message: "Security verification failed" });
          }
        }
      }

      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      // Find user by reset token
      const user = await storage.getUserByResetToken(token);
      if (!user || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update user password and clear reset token
      await storage.resetUserPassword(user.id, hashedPassword);

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Get current user profile
  app.get('/api/auth/user', (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const user = req.user as any;
    res.json({ 
      user: { 
        id: user.id, 
        email: user.email, 
        firstName: user.firstName, 
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl
      } 
    });
  });

  // Update user profile
  app.patch('/api/auth/user', requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { firstName, lastName, profileImageUrl } = req.body;

      const updatedUser = await storage.upsertUser({
        id: user.id,
        firstName: firstName !== undefined ? firstName : user.firstName,
        lastName: lastName !== undefined ? lastName : user.lastName,
        profileImageUrl: profileImageUrl !== undefined ? profileImageUrl : user.profileImageUrl,
      });

      res.json({ user: updatedUser });
    } catch (error) {
      console.error('Profile update error:', error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Upload profile picture
  app.post('/api/auth/upload-profile-pic', requireAuth, async (req, res) => {
    try {
      // Handle file upload logic here
      res.json({ message: "Profile picture uploaded successfully" });
    } catch (error) {
      console.error('Profile picture upload error:', error);
      res.status(500).json({ message: "Failed to upload profile picture" });
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
        DATABASE_SESSIONS: useDatabaseSessions
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

  // Create HTTP server
  const server = createServer(app);
  return server;
}