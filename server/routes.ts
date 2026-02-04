import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage.js";
import bcrypt from "bcryptjs";

// Extend Express Request type to include session properties
declare global {
  namespace Express {
    interface Request {
      session?: {
        isAdminLoggedIn?: boolean;
        adminId?: string;
        [key: string]: any;
      };
    }
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Trust proxy for Vercel
  app.set('trust proxy', 1);

  // Auth Middlewares
  const requireAuth = (req: Request, res: any, next: any) => {
    if (req.session?.isAdminLoggedIn) return next();
    res.status(401).json({ message: "Authentication required" });
  };


  // Removed contact form endpoint as per requirement
  // Cloudflare Turnstile will be used for login protection instead

  // Admin management routes
  app.get('/api/admin/list', async (req: Request, res: any) => {
    if (!req.session?.isAdminLoggedIn) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const admins = await storage.getAllAdmins();
    res.json(admins.map(a => ({ id: a.id, pin: a.pin, updatedAt: a.updatedAt })));
  });

  app.post('/api/admin/create', async (req: Request, res: any) => {
    try {
      const admins = await storage.getAllAdmins();
      if (admins.length > 0 && !req.session?.isAdminLoggedIn) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { pin, email, password } = req.body;
      if (!pin || !password) {
        return res.status(400).json({ message: "PIN and password are required" });
      }
      const hash = await bcrypt.hash(password, 10);
      await storage.setAdminPassword(pin, email || null, hash);
      res.json({ success: true });
    } catch (error) {
      console.error('Admin creation error:', error);
      res.status(500).json({ message: "Failed to create admin" });
    }
  });

  app.delete('/api/admin/:id', async (req: Request, res: any) => {
    if (!req.session?.isAdminLoggedIn) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    await storage.deleteAdmin(req.params.id);
    res.json({ success: true });
  });

  app.post('/api/admin/login', async (req: Request, res: any) => {
    try {
      const { pin, password } = req.body;
      
      console.log(`[Login] PIN: ${pin}, Password provided: ${!!password}`);
      const admin = await storage.getAdminByPin(pin);
      if (!admin) {
        return res.status(401).json({ message: "Invalid PIN or password" });
      }

      const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid PIN or password" });
      }

      req.session!.isAdminLoggedIn = true;
      req.session!.adminId = admin.id;
      
      req.session!.save((err: any) => {
        if (err) return res.status(500).json({ message: "Session save failed" });
        res.json({ success: true });
      });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post('/api/admin/logout', (req: Request, res: any) => {
    req.session!.destroy(() => res.json({ success: true }));
  });

  app.get('/api/users', requireAuth, async (req: Request, res: any) => {
    const allUsers = await storage.getAllUsers();
    res.json(allUsers);
  });

  // Endpoint to toggle user block status
  app.post('/api/users/:id/toggle-block', requireAuth, async (req: Request, res: any) => {
    try {
      const { id } = req.params;
      const updatedUser = await storage.toggleUserBlock(id);
      res.json(updatedUser);
    } catch (error: any) {
      console.error('Toggle user block error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/admin/stats', requireAuth, async (req: Request, res: any) => {
    const allUsers = await storage.getAllUsers();
    const allRequests = await storage.getAllProjectRequests();
    res.json({
      totalUsers: allUsers.length,
      totalRequests: allRequests.length,
      pendingRequests: allRequests.filter(r => r.status === 'pending').length,
      blockedUsers: allUsers.filter(u => u.isBlocked).length
    });
  });

  app.get('/api/project-requests', requireAuth, async (req: Request, res: any) => {
    const requests = await storage.getAllProjectRequests();
    res.json(requests);
  });

  app.delete('/api/projects/:id', requireAuth, async (req: Request, res: any) => {
    await storage.deleteProjectRequest(req.params.id);
    res.json({ message: "Project deleted" });
  });

  const httpServer = createServer(app);
  return httpServer;
}