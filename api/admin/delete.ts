import { type Request, Response } from "express";
import { storage } from "../../server/storage.js";

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'DELETE') return res.status(405).end();
  
  if (!(req.session as any)?.isAdminLoggedIn) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  const id = req.url?.split('/').pop();
  if (id) {
    await storage.deleteAdmin(id);
    res.json({ success: true });
  } else {
    res.status(400).json({ message: "ID required" });
  }
}
