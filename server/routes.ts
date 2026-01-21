import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage.js";
import { insertProjectRequestSchema } from "./../shared/schema.js";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";

export async function registerRoutes(app: Express): Promise<Server> {
  // Trust proxy for Vercel
  app.set('trust proxy', 1);

  // Setup replit auth (includes session and passport)
  await setupAuth(app);
  registerAuthRoutes(app);

  // Admin management routes
  app.post('/api/admin/login', async (req, res) => {
    try {
      const user = req.user as any;
      if (!user.isAdmin) return res.status(403).json({ message: "Forbidden" });
      const allUsers = await storage.getAllUsers();
      res.json(allUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post('/api/users/:id/toggle-block', requireAuth, requireAdminPassword, async (req, res) => {
    try {
      const user = req.user as any;
      if (!user.isAdmin) return res.status(403).json({ message: "Forbidden" });
      const updatedUser = await storage.toggleUserBlock(req.params.id);
      res.json(updatedUser);
    } catch (error) {
      res.status(500).json({ message: "Failed to toggle block status" });
    }
  });

  app.get('/api/admin/stats', requireAuth, requireAdminPassword, async (req, res) => {
    try {
      const user = req.user as any;
      if (!user.isAdmin) return res.status(403).json({ message: "Forbidden" });
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
      const requests = await storage.getAllProjectRequests(); // Changed to get all for management
      res.json(requests);
    } catch (error) {
      console.error('Project requests fetch error:', error);
      res.status(500).json({ message: "Failed to fetch project requests" });
    }
  });

  app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      // Note: Implement storage.deleteProjectRequest in storage.ts
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
      
      let userInteraction: any = null;
      if (req.isAuthenticated()) {
        const user = req.user as any;
        const interaction = await storage.getUserInteraction(projectId, user.id);
        userInteraction = interaction || null;
      }
      
      res.json({ 
        likes, 
        averageRating, 
        userInteraction 
      });
    } catch (error) {
      console.error('Fetch interactions error:', error);
      res.status(500).json({ message: "Failed to fetch project interactions" });
    }
  });

  app.post('/api/projects/:projectId/interactions', requireAuth, async (req, res) => {
    try {
      const { projectId } = req.params;
      const user = req.user as any;
      const { isLiked, rating } = req.body;

      const interaction = await storage.upsertProjectInteraction({
        projectId,
        userId: user.id,
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
