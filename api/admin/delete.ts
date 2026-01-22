import { type Request, Response } from "express";
import { storage } from "../../server/storage.js";

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'DELETE') return res.status(405).end();
  
  if (!(req.session as any)?.isAdminLoggedIn) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const idStr = url.searchParams.get('id') || url.pathname.split('/').pop();
  
  if (idStr) {
    const id = parseInt(idStr, 10);
    if (!isNaN(id)) {
      await storage.deleteAdmin(id);
      res.json({ success: true });
      return;
    }
  }
  
  res.status(400).json({ message: "Valid ID required" });
}
