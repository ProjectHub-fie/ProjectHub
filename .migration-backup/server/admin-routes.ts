import { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import multer from "multer";
import { adminStorage } from "./admin-storage.js";

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

  return createServer(app);
}