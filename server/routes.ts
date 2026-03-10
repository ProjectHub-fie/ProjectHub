import { createServer, type Server } from "http";
import session from "express-session";
import bcrypt from "bcryptjs";
import { storage } from "./storage.js";
import { setupPassport, authenticate, requireAuth } from "./auth.js";
import { insertProjectRequestSchema } from "./../shared/schema.js";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { Resend } from 'resend';

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

  // Initialize passport
  setupPassport(expressApp);

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

    authenticate('local', (err: any, user: any, info: any) => {
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

  expressApp.get('/api/projects/:slug', async (req: any, res: any) => {
    try {
      const project = await storage.getVerifiedProjectBySlug(req.params.slug);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch project details" });
    }
  });

  expressApp.post('/api/projects/:projectId/interactions', requireAuth, async (req: any, res: any) => {
    try {
      const interaction = await storage.upsertProjectInteraction({
        ...req.body,
        projectId: req.params.projectId,
        userId: req.user.id
      });
      res.json(interaction);
    } catch (error) {
      res.status(500).json({ message: "Failed to record interaction" });
    }
  });

  expressApp.get('/api/projects/:projectId/interactions', async (req: any, res: any) => {
    try {
      const stats = await storage.getProjectInteractions(req.params.projectId);
      let userInteraction = null;
      if (req.isAuthenticated()) {
        userInteraction = await storage.getUserInteraction(req.params.projectId, req.user.id);
      }
      res.json({ ...stats, userInteraction });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch interactions" });
    }
  });

  expressApp.post('/api/contact', async (req: any, res: any) => {
    try {
      const { name, email, subject, message, captchaToken } = req.body;

      if (!name || !email || !subject || !message) {
        return res.status(400).json({ message: "All fields are required" });
      }

      // Verify Turnstile captcha if in production
      if (process.env.NODE_ENV === 'production' && captchaToken) {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
        if (turnstileSecret) {
          try {
            const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `secret=${turnstileSecret}&response=${captchaToken}`
            });
            const verifyData: any = await verifyResponse.json();
            if (!verifyData.success) {
              return res.status(400).json({ message: "Captcha verification failed" });
            }
          } catch (err) {
            console.error('Captcha verification error:', err);
            return res.status(500).json({ message: "Security verification failed" });
          }
        }
      }

      // Send email using Resend
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        console.error('RESEND_API_KEY is not configured');
        return res.status(500).json({ message: "Email service is not configured" });
      }

      const resend = new Resend(resendApiKey);

      // Send email to yourself (project owner)
      const ownerEmail = 'dev.projecthub.fie@gmail.com';
      
      const emailResult = await resend.emails.send({
        from: 'Contact Form <onboarding@resend.dev>',
        to: ownerEmail,
        replyTo: email,
        subject: `New Contact Form Submission: ${subject}`,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>From:</strong> ${name} (${email})</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <h3>Message:</h3>
          <p>${message.replace(/\n/g, '<br>')}</p>
        `
      });

      if (emailResult.error) {
        console.error('Email sending error:', emailResult.error);
        return res.status(500).json({ message: "Failed to send email" });
      }

      console.log('Contact form email sent successfully:', emailResult.data);
      res.json({ message: "Message sent successfully" });
    } catch (error: any) {
      console.error('Contact endpoint error:', error);
      res.status(500).json({ message: "Failed to process contact form" });
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
