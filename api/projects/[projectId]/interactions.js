import { storage } from "../../../server/storage.js";
import { parse } from "cookie";

export default async function handler(req, res) {
  const { projectId } = req.query;

  if (req.method === 'GET') {
    try {
      const { likes, averageRating } = await storage.getProjectInteractions(projectId);
      
      let userInteraction = null;
      const cookies = parse(req.headers.cookie || '');
      const sessionToken = cookies['connect.sid'];

      if (sessionToken) {
        try {
          const userData = JSON.parse(Buffer.from(sessionToken, 'base64').toString());
          const interaction = await storage.getUserInteraction(projectId, userData.id);
          userInteraction = interaction || null;
        } catch (e) {}
      }
      
      res.json({ likes, averageRating, userInteraction });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch interactions" });
    }
  } else if (req.method === 'POST') {
    try {
      const cookies = parse(req.headers.cookie || '');
      const sessionToken = cookies['connect.sid'];

      if (!sessionToken) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const userData = JSON.parse(Buffer.from(sessionToken, 'base64').toString());
      const { isLiked, rating } = req.body;

      const interaction = await storage.upsertProjectInteraction({
        projectId,
        userId: userData.id,
        isLiked: isLiked?.toString(),
        rating: rating?.toString(),
      });

      res.json(interaction);
    } catch (error) {
      res.status(500).json({ message: "Failed to update interaction" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
}
