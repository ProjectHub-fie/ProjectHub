import { storage } from "./lib/storage.js";
import { parse } from "cookie";

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Sesssion');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      // Get all project requests (public endpoint)
      const requests = await storage.getAllProjectRequests();
      return res.json({ requests });
    }

    if (req.method === 'POST') {
      // Parse body
      let body = {};
      if (req.headers['content-type']?.includes('application/json')) {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString());
      }

      const { title, description, projectType, budget, timeline, contactMethod, urgency, additionalInfo } = body;

      // Validate required fields
      if (!title || !description) {
        return res.status(400).json({ message: "Title and description are required" });
      }

      // Get user from session (optional - for authenticated users)
      const cookies = parse(req.headers.cookie || '');
      let sessionToken = cookies['connect.sid'] || req.headers['x-user-session'];
      let userId = null;

      if (sessionToken) {
        try {
          const decodedSession = Buffer.from(sessionToken, 'base64').toString();
          const userData = JSON.parse(decodedSession);
          userId = userData.id;
        } catch (e) {
          // Invalid session, continue without user association
          console.log('Invalid session token, creating anonymous request');
        }
      }

      // Create project request
      const request = await storage.createProjectRequest({
        userId,
        title,
        description,
        projectType: projectType || 'other',
        budget: budget || 'not-specified',
        timeline: timeline || 'not-specified',
        contactMethod: contactMethod || 'email',
        urgency: urgency || 'medium',
        additionalInfo: additionalInfo || ''
      });

      return res.status(201).json({ request });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error('Project requests handler error:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
}