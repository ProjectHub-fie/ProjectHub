import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage.js";
import { insertProjectRequestSchema } from "./../shared/schema.js";

export async function registerRoutes(app: Express): Promise<Server> {
  // Trust proxy for Vercel
  app.set('trust proxy', 1);

  // Use a simple session
  const session = (await import("express-session")).default;
  const PostgresStore = (await import("connect-pg-simple")).default(session);

  app.use(session({
    store: new PostgresStore({
      conString: process.env.DATABASE_URL,
      tableName: 'sessions',
      createTableIfMissing: false
    }),
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: { 
      secure: true, 
      sameSite: 'none',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true
    }
  }));

  // Setup replit auth (includes session and passport)

  // Auth Middlewares
  const requireAuth = (req: any, res: any, next: any) => {
    if ((req.session as any).isAdminLoggedIn) return next();
    res.status(401).json({ message: "Authentication required" });
  };

  const requireAdminPassword = requireAuth;

  // Admin management routes
  app.get('/api/admin/list', async (req, res) => {
    if (!(req.session as any).isAdminLoggedIn) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const admins = await storage.getAllAdmins();
    // Don't return hashes
    res.json(admins.map(a => ({ id: a.id, pin: a.pin, updatedAt: a.updatedAt })));
  });

  app.post('/api/admin/create', async (req, res) => {
    try {
      // Allow creating first admin without authentication
      const admins = await storage.getAllAdmins();
      if (admins.length > 0 && !(req.session as any).isAdminLoggedIn) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { pin, email, password } = req.body;
      if (!pin || !email || !password) {
        return res.status(400).json({ message: "PIN, email and password are required" });
      }
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.default.hash(password, 10);
      await storage.setAdminPassword(pin, email, hash);
      res.json({ success: true });
    } catch (error) {
      console.error('Admin creation error:', error);
      res.status(500).json({ message: "Failed to create admin" });
    }
  });

  app.delete('/api/admin/:id', async (req, res) => {
    if (!(req.session as any).isAdminLoggedIn) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    await storage.deleteAdmin(req.params.id);
    res.json({ success: true });
  });

  // Debug endpoint - check if admin exists
  app.get('/api/admin/check', async (req, res) => {
    try {
      const admins = await storage.getAllAdmins();
      res.json({ 
        adminCount: admins.length,
        admins: admins.map(a => ({ id: a.id, pin: a.pin })),
        isSessionLoggedIn: (req.session as any).isAdminLoggedIn || false,
        sessionId: req.sessionID,
        sessionData: {
          isAdminLoggedIn: (req.session as any).isAdminLoggedIn,
          adminId: (req.session as any).adminId,
          adminPin: (req.session as any).adminPin
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error checking admins", error: error.message });
    }
  });

  app.post('/api/admin/login', async (req, res) => {
    const { username: pin, password } = req.body;
    const bcrypt = await import("bcryptjs");
    
    try {
      console.log(`Login attempt for PIN: ${pin}`);
      // Check database credentials
      const admin = await storage.getAdminByPin(pin);
      
      if (!admin) {
        console.log(`Admin not found for PIN: ${pin}`);
        return res.status(401).json({ message: "Invalid PIN or password" });
      }

      const isPasswordValid = await bcrypt.default.compare(password, admin.passwordHash);
      
      if (!isPasswordValid) {
        console.log(`Password mismatch for PIN: ${pin}`);
        return res.status(401).json({ message: "Invalid PIN or password" });
      }

      console.log(`Password verified for PIN: ${pin}, saving session...`);
      (req.session as any).isAdminLoggedIn = true;
      (req.session as any).adminId = admin.id;
      (req.session as any).adminPin = pin;
      
      return new Promise((resolve) => {
        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            console.log("Session object:", req.session);
            res.status(500).json({ message: "Session save failed", error: err.message });
            return resolve(true);
          }
          console.log('Session saved successfully, session ID:', req.sessionID);
          console.log('Session data:', req.session);
          res.json({ success: true, sessionId: req.sessionID });
          resolve(true);
        });
      });
    } catch (error: any) {
      console.error('Login error:', error);
      res.status(500).json({ message: "Internal server error", error: error.message });
    }
  });

  app.post('/api/admin/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy error:", err);
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  app.get('/api/users', requireAuth, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      res.json(allUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post('/api/users/:id/toggle-block', requireAuth, async (req, res) => {
    try {
      const updatedUser = await storage.toggleUserBlock(req.params.id);
      res.json(updatedUser);
    } catch (error) {
      res.status(500).json({ message: "Failed to toggle block status" });
    }
  });

  app.get('/api/admin/stats', requireAuth, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const allRequests = await storage.getAllProjectRequests();
      res.json({
        totalUsers: allUsers.length,
        totalRequests: allRequests.length,
        pendingRequests: allRequests.filter(r => r.status === 'pending').length,
        blockedUsers: allUsers.filter(u => u.isBlocked).length
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });
  app.post('/api/project-requests', requireAuth, async (req, res) => {
    try {
      // In PIN auth, we don't have a user object attached to session except the flag
      // For now, we'll use a dummy ID or handle this differently if user system is needed
      const validatedData = insertProjectRequestSchema.parse({
        ...req.body,
        userId: "00000000-0000-0000-0000-000000000000" // Placeholder for admin actions
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
      const requests = await storage.getAllProjectRequests();
      res.json(requests);
    } catch (error) {
      console.error('Project requests fetch error:', error);
      res.status(500).json({ message: "Failed to fetch project requests" });
    }
  });

  app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteProjectRequest(id);
      res.json({ message: "Project deleted" });
    } catch (error) {
      console.error('Delete project error:', error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  app.get('/api/projects/:projectId/interactions', async (req, res) => {
    try {
      const { projectId } = req.params;
      const { likes, averageRating } = await storage.getProjectInteractions(projectId);
      res.json({ 
        likes, 
        averageRating, 
        userInteraction: null 
      });
    } catch (error) {
      console.error('Fetch interactions error:', error);
      res.status(500).json({ message: "Failed to fetch project interactions" });
    }
  });

  app.post('/api/projects/:projectId/interactions', requireAuth, async (req, res) => {
    try {
      const { projectId } = req.params;
      const { isLiked, rating } = req.body;

      const interaction = await storage.upsertProjectInteraction({
        projectId,
        userId: "00000000-0000-0000-0000-000000000000",
        isLiked: isLiked?.toString(),
        rating: rating?.toString(),
      });

      res.json(interaction);
    } catch (error) {
      console.error('Update interaction error:', error);
      res.status(500).json({ message: "Failed to update project interaction" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
