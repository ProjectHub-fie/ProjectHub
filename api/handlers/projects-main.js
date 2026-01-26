import { storage } from "../lib/storage.js";
import nc from "next-connect";

const handler = nc()
  .get(async (req, res) => {
    try {
      const { projectId } = req.query;
      const { userId } = req.query;
      const { likes, averageRating } = await storage.getProjectInteractions(projectId);
      let userInteraction = null;
      if (userId) {
        userInteraction = await storage.getUserInteraction(projectId, userId);
      }
      res.json({ likes, averageRating, userInteraction });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch interactions" });
    }
  })
  .post(async (req, res) => {
    try {
      const { projectId } = req.query;
      const { userId, isLiked, rating } = req.body;
      const interaction = await storage.upsertProjectInteraction({
        projectId,
        userId,
        isLiked: isLiked?.toString(),
        rating: rating?.toString(),
      });
      res.json(interaction);
    } catch (error) {
      res.status(500).json({ message: "Failed to update interaction" });
    }
  });

export default handler;