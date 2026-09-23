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
import {
  sendPasswordResetEmail,
  sendPublicEmail,
  contactRecipient,
  resolveOrigin,
  passwordResetEmail,
  contactNotificationEmail,
  createResetToken,
  hashResetToken,
} from '../api/lib/email.js';

// Server-side email validation. The contact form validates too, but the browser
// can be bypassed, so this is the check that actually holds.
const EMAIL_PATTERN = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const BLOCKED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'invalid.com',
  'localhost',
]);

/** Returns an error message, or null when the address is acceptable. */
function emailProblem(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'Email is required';
  const email = value.trim();
  if (email.length > 254) return 'Email address is too long';
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address';

  const [local, domain] = email.split('@');
  if (local.length > 64) return 'Email address is too long';
  if (local.includes('..') || domain.includes('..')) return 'Enter a valid email address';
  if (BLOCKED_EMAIL_DOMAINS.has(domain.toLowerCase())) return 'Please use a real email address';
  return null;
}

// Password rules enforced on register and reset. Kept in step with
// client/src/lib/password-validation.ts; the form is not a security boundary.
const PASSWORD_MIN_LENGTH = 8;
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'letmein',
  'welcome',
  'admin123',
  'iloveyou',
  'monkey123',
  'dragon123',
  'football1',
  'abc12345',
  'passw0rd',
  'projecthub',
]);

/** Returns an error message, or null when the password is acceptable. */
function passwordProblem(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'Password is required';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    return 'That password is too common; choose something less predictable';
  }

  const missing: string[] = [];
  if (!/[a-z]/.test(value)) missing.push('a lowercase letter');
  if (!/[A-Z]/.test(value)) missing.push('an uppercase letter');
  if (!/[0-9]/.test(value)) missing.push('a number');
  if (!/[^A-Za-z0-9]/.test(value)) missing.push('a special character');
  if (/\s/.test(value)) missing.push('no spaces');

  if (missing.length) return `Password must include ${missing.join(', ')}`;
  return null;
}

/**
 * Verifies a Cloudflare Turnstile token.
 *
 * Disabled when no secret is configured, matching the serverless API and the
 * client's `captchaRequired`. Kept in step with api/index.js so the two
 * backends accept the same submissions.
 */
async function verifyTurnstile(captchaToken: unknown, remoteIp: unknown): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;

  const body = new URLSearchParams({ secret, response: String(captchaToken || '') });
  if (remoteIp) body.set('remoteip', String(remoteIp));

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch (error: any) {
    console.error('Turnstile verification error:', error.message);
    return false;
  }
}

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

      const passwordError = passwordProblem(password);
      if (passwordError) {
        return res.status(400).json({ message: passwordError });
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

  /* -----------------------------------------------------------------------
     Password recovery.

     Mirrors api/index.js so the dev server behaves like production: the token
     is stored as a hash, mail goes out through Mailjet, and the response never
     reveals whether the address exists.
  ----------------------------------------------------------------------- */
  const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

  async function handleForgotPassword(req: any, res: any) {
    const { email, captchaToken } = req.body || {};
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const problem = emailProblem(email);
    if (problem) return res.status(400).json({ message: problem });

    if (!(await verifyTurnstile(captchaToken, req.headers['x-forwarded-for']))) {
      return res.status(400).json({ message: 'Captcha verification failed' });
    }

    try {
      const user = await storage.getUserByEmail(email);
      if (user) {
        const resetToken = createResetToken();
        const expiry = new Date(Date.now() + RESET_TOKEN_TTL_MS);
        await storage.updateUserResetToken(user.id, hashResetToken(resetToken), expiry);

        const origin = resolveOrigin(req);
        const resetUrl = origin
          ? `${origin}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(resetToken)}`
          : null;
        const { subject, html, text } = passwordResetEmail(resetToken, resetUrl);
        const result = await sendPasswordResetEmail({ to: email, subject, html, text });

        if (!result.sent) {
          const reason =
            result.reason === 'not_configured'
              ? 'Email is not configured on the server'
              : 'Failed to send the reset email';
          return res.status(502).json({ message: reason });
        }
      }

      // Same answer whether or not the account exists: the form must not be
      // usable to enumerate registered addresses.
      return res.json({ message: 'Password reset instructions sent to your email' });
    } catch (error: any) {
      console.error('Forgot password error:', error.message);
      return res.status(500).json({ message: 'Failed to process password reset request' });
    }
  }

  async function handleResetPassword(req: any, res: any) {
    const { token, newPassword, email } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }

    if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN_LENGTH) {
      return res
        .status(400)
        .json({ message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long` });
    }

    const problem = passwordProblem(newPassword);
    if (problem) return res.status(400).json({ message: problem });

    try {
      const user = await storage.getUserByResetToken(hashResetToken(token));
      if (!user || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
        return res.status(400).json({ message: 'Invalid or expired reset token' });
      }
      if (email && user.email && String(email).toLowerCase() !== user.email.toLowerCase()) {
        return res.status(400).json({ message: 'Invalid or expired reset token' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await storage.resetUserPassword(user.id, hashedPassword);
      return res.json({ message: 'Password reset successfully' });
    } catch (error: any) {
      console.error('Reset password error:', error.message);
      return res.status(500).json({ message: 'Failed to reset password' });
    }
  }

  expressApp.post('/api/auth/forgot-password', handleForgotPassword);
  expressApp.post('/api/auth/reset-password', handleResetPassword);
  expressApp.post('/api/auth/recovery', async (req: any, res: any) => {
    if (req.query?.action === 'reset') return handleResetPassword(req, res);
    return handleForgotPassword(req, res);
  });

  /* -----------------------------------------------------------------------
     Discord OAuth2 (mirrors the serverless implementation in api/index.js so
     local development behaves like production).
  ----------------------------------------------------------------------- */
  const discordRedirectUri = () =>
    process.env.DISCORD_CALLBACK_URL ||
    `${process.env.APP_ORIGIN || ''}/api/auth/discord/callback`;

  expressApp.get('/api/auth/discord', (req: any, res: any) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ message: 'Discord login is not configured' });
    }

    // Stateless signed nonce: the callback rejects handshakes we did not start.
    const state = Buffer.from(
      JSON.stringify({ t: Date.now(), s: 'discord' })
    ).toString('base64url');

    const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', discordRedirectUri());
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'identify email');
    authorizeUrl.searchParams.set('state', state);

    res.redirect(authorizeUrl.toString());
  });

  expressApp.get('/api/auth/discord/callback', async (req: any, res: any) => {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      return res.redirect(`/login?discord=error&reason=${encodeURIComponent(String(oauthError))}`);
    }
    if (!code || !state) {
      return res.redirect('/login?discord=error&reason=missing_code');
    }

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.redirect('/login?discord=error&reason=not_configured');
    }

    try {
      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: discordRedirectUri(),
        }),
      });

      if (!tokenRes.ok) {
        return res.redirect('/login?discord=error&reason=token_exchange');
      }
      const { access_token: accessToken } = await tokenRes.json();

      const profileRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!profileRes.ok) {
        return res.redirect('/login?discord=error&reason=profile');
      }
      const profile = await profileRes.json();
      const displayName = profile.global_name || profile.username || 'Discord User';
      const avatarUrl = profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
        : null;

      let user = await storage.getUserBySocialId('discord', profile.id);
      if (!user && profile.email) {
        user = await storage.getUserByEmail(profile.email);
      }

      if (user) {
        user = (await storage.upsertUser({
          id: user.id,
          discordId: profile.id,
          profileImageUrl: user.profileImageUrl || avatarUrl,
        })) as any;
      } else {
        user = (await storage.upsertUser({
          email: profile.email || null,
          firstName: displayName,
          lastName: '',
          discordId: profile.id,
          profileImageUrl: avatarUrl,
        })) as any;
      }

      req.login(user, (err: any) => {
        if (err) {
          return res.redirect('/login?discord=error&reason=session');
        }
        res.redirect('/dashboard');
      });
    } catch (err: any) {
      console.error('Discord callback error:', err.message);
      res.redirect('/login?discord=error&reason=unexpected');
    }
  });

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

      const emailError = emailProblem(email);
      if (emailError) {
        return res.status(400).json({ message: emailError });
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

      // Send the notification through the shared Resend utility. The Resend
      // key lives only on the server, and `sendPublicEmail` reports a real
      // success/failure instead of assuming a send happened.
      const ownerEmail = contactRecipient();
      const { subject: mailSubject, html, text } = contactNotificationEmail({
        name,
        email,
        subject,
        message,
      });

      const emailResult = await sendPublicEmail({
        to: ownerEmail,
        subject: mailSubject,
        html,
        text,
        replyTo: email,
      });

      if (!emailResult.sent) {
        console.error('Contact form email failed:', emailResult.reason, emailResult.errorMessage);
        return res.status(502).json({ message: "Failed to send email" });
      }

      console.log('Contact form email sent successfully');
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
