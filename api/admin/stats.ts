import { type Request, Response } from "express";
import { storage } from "../../server/storage.js";

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'GET') return res.status(405).end();
  
  if (!(req.session as any)?.isAdminLoggedIn) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  const allUsers = await storage.getAllUsers();
  const allRequests = await storage.getAllProjectRequests();
  
  res.json({
    totalUsers: allUsers.length,
    totalRequests: allRequests.length,
    pendingRequests: allRequests.filter(r => r.status === 'pending').length,
    blockedUsers: allUsers.filter(u => u.isBlocked).length
  });
}
