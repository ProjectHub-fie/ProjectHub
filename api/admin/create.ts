import { type Request, Response } from "express";
import { storage } from "../../server/storage.js";
import bcrypt from "bcryptjs";

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).end();
  
  if (!(req.session as any)?.isAdminLoggedIn) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  const { pin, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await storage.setAdminPassword(pin, hash);
  res.json({ success: true });
}
