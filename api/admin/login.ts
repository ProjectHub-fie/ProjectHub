import { type Request, Response } from "express";
import { storage } from "../../server/storage.js";
import bcrypt from "bcryptjs";

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { username: pin, password } = req.body;
  const admin = await storage.getAdminByPin(pin);
  
  if (admin && await bcrypt.compare(password, admin.passwordHash)) {
    (req.session as any).isAdminLoggedIn = true;
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({ message: "Session save failed" });
      }
      res.json({ success: true });
    });
  } else {
    res.status(401).json({ message: "Invalid PIN or password" });
  }
}
