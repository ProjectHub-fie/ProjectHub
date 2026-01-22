import { storage } from "./lib/storage.js";
import { insertProjectRequestSchema } from "../shared/schema.js";
import { parse } from "cookie";

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const cookies = parse(req.headers.cookie || '');
      const sessionToken = cookies['connect.sid'];
      
      let userId = req.body.userId;
      if (!userId && sessionToken) {
        try {
          const userData = JSON.parse(Buffer.from(sessionToken, 'base64').toString());
          userId = userData.id;
        } catch (e) {}
      }

      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const validatedData = insertProjectRequestSchema.parse({
        ...req.body,
        userId
      });

      const projectRequest = await storage.createProjectRequest(validatedData);
      res.json(projectRequest);
    } catch (error) {
      res.status(500).json({ message: "Failed to create project request" });
    }
  } else if (req.method === 'GET') {
    try {
      const cookies = parse(req.headers.cookie || '');
      const sessionToken = cookies['connect.sid'];
      
      let userId = req.query.userId;
      if (!userId && sessionToken) {
        try {
          const userData = JSON.parse(Buffer.from(sessionToken, 'base64').toString());
          userId = userData.id;
        } catch (e) {}
      }

      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const requests = await storage.getProjectRequests(userId);
      res.json(requests);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch project requests" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
}
