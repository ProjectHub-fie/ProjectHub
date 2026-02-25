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
        adminRole?: string;
        [key: string]: any;
      };
    }
  }
}

// Role-based permissions
const PERMISSIONS = {
  owner: ['create_admin', 'delete_admin', 'manage_moderators', 'manage_projects', 'view_users', 'change_roles'],
  admin: ['create_moderator', 'manage_projects', 'view_users'],
  moderator: ['manage_projects', 'view_users']
};

function hasPermission(role: string, permission: string): boolean {
  if (role === 'owner') return true; // Owner has all permissions
  return PERMISSIONS[role as keyof typeof PERMISSIONS]?.includes(permission) || false;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Trust proxy for Vercel
  app.set('trust proxy', 1);

  // Auth Middlewares
  const requireAuth = (req: Request, res: any, next: any) => {
    if (req.session?.isAdminLoggedIn) return next();
    res.status(401).json({ message: "Authentication required" });
  };

  const requireRole = (requiredRole: string) => {
    return (req: Request, res: any, next: any) => {
      if (!req.session?.isAdminLoggedIn) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      const userRole = req.session.adminRole;
      if (!userRole) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }

      // Check role hierarchy
      const roleHierarchy = ['moderator', 'admin', 'owner'];
      const userLevel = roleHierarchy.indexOf(userRole);
      const requiredLevel = roleHierarchy.indexOf(requiredRole);
      
      if (userLevel < requiredLevel) {
        return res.status(403).json({ message: "Insufficient permissions for this operation" });
      }
      
      next();
    };
  };

  // Admin management routes
  app.get('/api/admin/list', requireAuth, async (req: Request, res: any) => {
    try {
      const admins = await storage.getAllAdmins();
      res.json(admins.map(a => ({ 
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
      const { pin, email, password, role = 'moderator' } = req.body;
      
      if (!pin || !password) {
        return res.status(400).json({ message: "PIN and password are required" });
      }

      // Validate role assignment permissions
      const creatorRole = req.session!.adminRole;
      if (creatorRole === 'admin' && role !== 'moderator') {
        return res.status(403).json({ message: "Admins can only create moderators" });
      }

      // Check if PIN already exists
      const existingAdmin = await storage.getAdminByPin(pin);
      if (existingAdmin) {
        return res.status(400).json({ message: "PIN already exists" });
      }

      const hash = await bcrypt.hash(password, 10);
      await storage.setAdminPassword(pin, email || null, hash, role);
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

      // Prevent owner from demoting themselves
      if (id === req.session!.adminId && role !== 'owner') {
        return res.status(400).json({ message: "Cannot change your own role" });
      }

      await storage.updateAdminRole(id, role);
      res.json({ success: true, message: "Role updated successfully" });
    } catch (error) {
      console.error('Role update error:', error);
      res.status(500).json({ message: "Failed to update role" });
    }
  });

  app.delete('/api/admin/:id', requireRole('admin'), async (req: Request, res: any) => {
    try {
      const { id } = req.params;
      
      // Prevent users from deleting themselves
      if (id === req.session!.adminId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      // Check if trying to delete an owner (only owners can delete other owners)
      const adminToDelete = await storage.getAdminByPin(id);
      if (adminToDelete?.role === 'owner' && req.session!.adminRole !== 'owner') {
        return res.status(403).json({ message: "Only owners can delete other owners" });
      }

      await storage.deleteAdmin(id);
      res.json({ success: true, message: "Admin deleted successfully" });
    } catch (error) {
      console.error('Admin deletion error:', error);
      res.status(500).json({ message: "Failed to delete admin" });
    }
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
      req.session!.adminRole = admin.role;
      
      req.session!.save((err: any) => {
        if (err) return res.status(500).json({ message: "Session save failed" });
        res.json({ 
          success: true,
          role: admin.role,
          message: "Login successful"
        });
      });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post('/api/admin/change-password', requireAuth, async (req: Request, res: any) => {
    try {
      const { id, currentPin, newPassword } = req.body;
      
      if (!id || !currentPin || !newPassword) {
        return res.status(400).json({ message: "ID, current PIN and new password are required" });
      }

      // Check if trying to change someone else's password (only owners can do this)
      if (id !== req.session!.adminId && req.session!.adminRole !== 'owner') {
        return res.status(403).json({ message: "Only owners can change other administrators' passwords" });
      }

      // Verify the current PIN matches the target admin
      const targetAdmin = await storage.getAdminByPin(currentPin);
      if (!targetAdmin || targetAdmin.id !== id) {
        return res.status(400).json({ message: "Invalid current PIN" });
      }

      const hash = await bcrypt.hash(newPassword, 10);
      
      // Update the password hash in the database
      // Using setAdminPassword logic but we need to update existing record
      // Let's add an updatePassword method to storage or reuse existing logic if possible
      // Looking at storage.ts, it has setAdminPassword which uses insert with conflict or something? 
      // Actually setAdminPassword in storage.ts uses db.insert().values(). 
      // I should check storage.ts again.
      
      await storage.setAdminPassword(targetAdmin.pin, targetAdmin.email, hash, targetAdmin.role);
      res.json({ success: true, message: "Password updated successfully" });
    } catch (error) {
      console.error('Password change error:', error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  app.post('/api/admin/logout', (req: Request, res: any) => {
    req.session!.destroy(() => res.json({ success: true }));
  });

  app.get('/api/admin/current-role', requireAuth, async (req: Request, res: any) => {
    try {
      const adminRole = req.session?.adminRole || 'moderator';
      res.json({ role: adminRole });
    } catch (error) {
      console.error('Error fetching admin role:', error);
      res.status(500).json({ message: "Failed to fetch admin role" });
    }
  });

  app.get('/api/users', requireRole('moderator'), async (req: Request, res: any) => {
    try {
      const allUsers = await storage.getAllUsers();
      res.json(allUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Endpoint to toggle user block status
  app.post('/api/users/:id/toggle-block', requireRole('moderator'), async (req: Request, res: any) => {
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
      console.error('Error fetching stats:', error);
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  app.get('/api/project-requests', requireRole('moderator'), async (req: Request, res: any) => {
    try {
      const requests = await storage.getAllProjectRequests();
      res.json(requests);
    } catch (error) {
      console.error('Error fetching project requests:', error);
      res.status(500).json({ message: "Failed to fetch project requests" });
    }
  });

  app.put('/api/projects/:id/status', requireRole('moderator'), async (req: Request, res: any) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!['pending', 'in_review', 'approved', 'rejected', 'completed'].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const updatedRequest = await storage.updateProjectRequestStatus(id, status);
      if (!updatedRequest) {
        return res.status(404).json({ message: "Project request not found" });
      }
      
      res.json(updatedRequest);
    } catch (error: any) {
      console.error('Project status update error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete('/api/projects/:id', requireRole('admin'), async (req: Request, res: any) => {
    try {
      await storage.deleteProjectRequest(req.params.id);
      res.json({ message: "Project deleted" });
    } catch (error) {
      console.error('Project deletion error:', error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  app.patch('/api/project-requests/:id/status', requireAuth, async (req, res) => {
    try {
      const { status } = req.body;
      if (!status) {
        return res.status(400).json({ message: "Status is required" });
      }
      const updated = await storage.updateProjectRequestStatus(req.params.id, status);
      if (!updated) {
        return res.status(404).json({ message: "Project request not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error('Status update error:', error);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}