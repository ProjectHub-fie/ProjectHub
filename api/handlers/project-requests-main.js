import { storage } from "./lib/storage.js";
import nc from "next-connect";

const handler = nc()
  .get(async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) return res.status(400).json({ message: "User ID required" });
      const requests = await storage.getProjectRequests(userId);
      res.json(requests);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch project requests" });
    }
  })
  .post(async (req, res) => {
    try {
      const { userId, title, description, budget, timeline, technologies } = req.body;
      if (!userId || !title || !description) return res.status(400).json({ message: "Missing required fields" });
      const projectRequest = await storage.createProjectRequest({ userId, title, description, budget, timeline, technologies });
      res.json(projectRequest);
    } catch (error) {
      res.status(500).json({ message: "Failed to create project request" });
    }
  });

export default handler;