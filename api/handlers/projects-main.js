import { storage } from "../lib/storage.js";
import { parse } from "cookie";

export default async function handler(req, res) {
  const projectId = req.query.projectId;
  
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Session');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      if (!projectId) {
        return res.status(400).json({ message: "Project ID is required" });
      }

      // Get project interactions (likes and ratings)
      const { likes, averageRating } = await storage.getProjectInteractions(projectId);
      
      // Get userId from query for GET requests
      const { userId } = req.query;
      let userInteraction = null;
      if (userId) {
        userInteraction = await storage.getUserInteraction(projectId, userId);
      }
      
      return res.json({ likes, averageRating, userInteraction });
    }

    if (req.method === 'POST') {
      if (!projectId) {
        return res.status(400).json({ message: "Project ID is required" });
      }

      // Parse body
      let body = {};
      if (req.headers['content-type']?.includes('application/json')) {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString());
      }

      const { isLiked, rating } = body;

      // Get user from session
      const cookies = parse(req.headers.cookie || '');
      let sessionToken = cookies['connect.sid'] || req.headers['x-user-session'];
      
      if (!sessionToken) {
        return res.status(401).json({ message: "Authentication required" });
      }

      let userData;
      try {
        const decodedSession = Buffer.from(sessionToken, 'base64').toString();
        userData = JSON.parse(decodedSession);
      } catch (e) {
        return res.status(401).json({ message: "Invalid session" });
      }

      // Update project interaction
      const interaction = await storage.upsertProjectInteraction({
        projectId,
        userId: userData.id,
        isLiked: isLiked !== undefined ? isLiked : undefined,
        rating: rating !== undefined ? rating : undefined
      });

      // Get updated interactions stats
      const interactions = await storage.getProjectInteractions(projectId);
      return res.json({ interaction, ...interactions });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error('Projects handler error:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
}