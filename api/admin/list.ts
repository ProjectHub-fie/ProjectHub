import { type Request, Response } from "express";
import { storage } from "../../server/storage.js";

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'GET') return res.status(405).end();
  
  if (!(req.session as any)?.isAdminLoggedIn) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  const admins = await storage.getAllAdmins();
  res.json(admins.map(a => ({ id: a.id, pin: a.pin, updatedAt: a.updatedAt })));
}
