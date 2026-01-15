import type { Express } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import bcrypt from "bcryptjs";
import { storage } from "./storage.js";
import passport from "./auth.js";
import { insertProjectRequestSchema } from "./../shared/schema.js";

// Middleware to check if user is authenticated
function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Authentication required" });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Trust proxy for Vercel
  app.set('trust proxy', 1);

  // Session configuration with PostgreSQL store
  const pgSession = (await import("connect-pg-simple")).default(session);
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  app.use(session({
    store: new pgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: true, // Force session saving to ensure cookie is set
    saveUninitialized: false,
    proxy: true, // Required for Vercel
    cookie: {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // Initialize passport
  app.use(passport.initialize());
  app.use(passport.session());

  // Auth routes
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, firstName, lastName, captchaToken } = req.body;

      if (captchaToken) {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
        console.log('Verifying Turnstile token, secret present:', !!(process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY));
        if (turnstileSecret) {
          try {
            const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `secret=${turnstileSecret}&response=${captchaToken}`
            });
            const verifyData: any = await verifyResponse.json();
            if (!verifyData.success) {
              console.error('Turnstile verification failed:', verifyData);
              return res.status(400).json({ message: "Security verification failed" });
            }
          } catch (verifyError) {
            console.error('Turnstile fetch error:', verifyError);
          }
        }
      }

      // Validate required fields
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: "All fields are required" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await storage.upsertUser({
        email,
        firstName,
        lastName,
        password: hashedPassword,
      });

      // Log user in
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ message: "Registration successful but login failed" });
        }
        res.json({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } });
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
  });

  app.post('/api/auth/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // Forgot password endpoint
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const { email, captchaToken } = req.body;

      if (captchaToken) {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
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

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Check if user exists
      const user = await storage.getUserByEmail(email);
      if (!user) {
        // Don't reveal if email exists or not for security
        return res.json({ message: "If an account with that email exists, you will receive a reset email" });
      }

      // Generate reset token
      const { randomBytes } = await import("crypto");
      const resetToken = randomBytes(32).toString('hex');
      const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

      // Save reset token to user
      await storage.updateUserResetToken(user.id, resetToken, resetTokenExpiry);

      // Send reset email using Mailjet
      const Mailjet = (await import('node-mailjet')).default;
      const mailjet = Mailjet.apiConnect(
        process.env.MAILJET_API_KEY || '',
        process.env.MAILJET_API_SECRET || ''
      );

      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${resetToken}`;
      
      await mailjet
        .post("send", { version: 'v3.1' })
        .request({
          Messages: [
            {
              From: {
                Email: process.env.EMAIL_USER || 'dev.projecthub.fie@gmail.com',
                Name: "ProjectHub"
              },
              To: [
                {
                  Email: email,
                  Name: user.firstName || ''
                }
              ],
              Subject: "Password Reset Request",
              HTMLPart: `
                <h2>Password Reset Request</h2>
                <p>Hello ${user.firstName},</p>
                <p>You requested to reset your password. Use the token below to reset your password:</p>
                <p><strong>Reset Token:</strong> <code>${resetToken}</code></p>
                <p>This token will expire in 1 hour.</p>
                <p>If you didn't request this, please ignore this email.</p>
                <hr>
                <p><em>ProjectHub Security Team</em></p>
              `
            }
          ]
        });

      res.json({ message: "If an account with that email exists, you will receive a reset email" });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ message: "Failed to process password reset request" });
    }
  });

  // Reset password endpoint
  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const { token, newPassword, captchaToken } = req.body;

      if (captchaToken) {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
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
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update user password and clear reset token
      await storage.resetUserPassword(user.id, hashedPassword);

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Discord OAuth routes - enabled when Discord credentials are available
  app.get('/api/auth/discord', (req, res, next) => {
    const { captchaToken } = req.query;
    if (!captchaToken && process.env.NODE_ENV === 'production') {
      return res.status(400).json({ message: "Captcha token required" });
    }
    // Store captcha token in session to verify in callback
    (req.session as any).discordCaptchaToken = captchaToken;
    passport.authenticate('discord')(req, res, next);
  });

  app.get('/api/auth/discord/callback', async (req, res, next) => {
    const captchaToken = (req.session as any).discordCaptchaToken;
    
    if (captchaToken) {
      const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
      if (turnstileSecret) {
        try {
          const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${turnstileSecret}&response=${captchaToken}`
          });
          const verifyData: any = await verifyResponse.json();
          if (!verifyData.success) {
            delete (req.session as any).discordCaptchaToken;
            return res.redirect('/login?error=captcha_failed');
          }
        } catch (err) {
          console.error('Discord callback Turnstile verification error:', err);
        }
      }
    }
    delete (req.session as any).discordCaptchaToken;

    passport.authenticate('discord', { 
      failureRedirect: '/login?error=discord_failed',
      successRedirect: '/dashboard?login=success'
    })(req, res, next);
  });

  // No-op for removed /api/auth/me
  app.get('/api/auth/me', (req, res) => {
    res.status(410).json({ message: "Endpoint removed" });
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

      // Synchronize the session
      req.login(updatedUser, (err) => {
        if (err) {
          console.error('Error re-logging user after profile update:', err);
          return res.status(500).json({ message: "Failed to update session" });
        }
        res.json({ 
          user: { 
            id: updatedUser.id, 
            email: updatedUser.email, 
            firstName: updatedUser.firstName, 
            lastName: updatedUser.lastName,
            profileImageUrl: updatedUser.profileImageUrl
          } 
        });
      });
    } catch (error) {
      console.error('Profile update error:', error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Profile picture upload
  const multer = (await import('multer')).default;
  const upload = multer({ 
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    storage: multer.memoryStorage()
  });

  app.post('/api/auth/upload-profile-pic', requireAuth, upload.single('file'), async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

    const user = req.user as any;
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    
    const updatedUser = await storage.upsertUser({
      id: user.id,
      profileImageUrl: base64Image
    });

    // Update the user in the session
    req.login(updatedUser, (err: any) => {
        if (err) {
          console.error('Error re-logging user after picture upload:', err);
          return res.status(500).json({ message: "Failed to update session" });
        }
        res.json({ 
          user: { 
            id: updatedUser.id,
            profileImageUrl: updatedUser.profileImageUrl
          } 
        });
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ message: "Failed to upload image" });
    }
  });

  // Contact form endpoint
  app.post('/api/contact', async (req: any, res: any) => {
    try {
      const { name, email, subject, message, captchaToken } = req.body;

      // Always try to verify if token is present
      if (captchaToken) {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
        console.log('Verifying Turnstile token, secret present:', !!(process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY));
        if (turnstileSecret) {
          try {
            const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `secret=${turnstileSecret}&response=${captchaToken}`
            });
            const verifyData: any = await verifyResponse.json();
            if (!verifyData.success) {
              console.error('Turnstile verification failed:', verifyData);
              return res.status(400).json({ message: "Security verification failed" });
            }
          } catch (verifyError) {
            console.error('Turnstile fetch error:', verifyError);
          }
        }
      }

      if (!process.env.RESEND_API_KEY) {
        return res.status(500).json({ message: "Email service not configured" });
      }

      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);

      const { data, error } = await resend.emails.send({
        from: 'Contact Form <onboarding@resend.dev>',
        to: process.env.EMAIL_USER || 'dev.projecthub.fie@gmail.com',
        subject: `New Contact Form: ${subject}`,
        replyTo: email,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Message:</strong></p>
          <p>${message.replace(/\n/g, '<br>')}</p>
          <hr>
          <p><em>Sent from ProjectHub contact form via Resend</em></p>
        `,
      });

      if (error) {
        console.error('Resend error:', error);
        return res.status(500).json({ message: "Failed to send email" });
      }

      res.json({ message: "Contact form submitted successfully" });
    } catch (error) {
      console.error('Contact form error:', error);
      res.status(500).json({ message: "Failed to submit contact form" });
    }
  });

  // Project request routes
  app.post('/api/project-requests', requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const validatedData = insertProjectRequestSchema.parse({
        ...req.body,
        userId: user.id
      });

      const projectRequest = await storage.createProjectRequest(validatedData);
      res.json(projectRequest);
    } catch (error) {
      console.error('Project request creation error:', error);
      res.status(500).json({ message: "Failed to create project request" });
    }
  });

  app.get('/api/project-requests', requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const requests = await storage.getProjectRequests(user.id);
      res.json(requests);
    } catch (error) {
      console.error('Project requests fetch error:', error);
      res.status(500).json({ message: "Failed to fetch project requests" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
