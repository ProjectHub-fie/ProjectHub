import { type Request, Response } from "express";
import { storage } from "../../server/storage.js";
import bcrypt from "bcryptjs";

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).end();
  
  // Vercel serverless session handling might be different, but for now we follow the pattern
  if (!(req.session as any)?.isAdminLoggedIn) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  try {
    const { pin, password } = req.body;
    if (!pin || !password) {
      return res.status(400).json({ message: "PIN and password are required" });
    }
    const hash = await bcrypt.hash(password, 10);
    await storage.setAdminPassword(pin, hash);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin creation error:', error);
    res.status(500).json({ message: "Internal server error" });
  }
}
