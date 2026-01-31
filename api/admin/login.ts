import { type Request, Response } from "express";
import { storage } from "../../server/storage.js";
import bcrypt from "bcryptjs";

export default async function handler(req: Request, res: Response) {
  console.log('Login attempt received');
  if (req.method !== 'POST') {
    console.log(`Method ${req.method} not allowed`);
    return res.status(405).end();
  }
  
  try {
    const { pin, password } = req.body;

    if (!pin || !password) {
      return res.status(400).json({ message: "PIN and password are required" });
    }

    console.log(`[Vercel Login] Attempting login for PIN: ${pin}`);
    
    const admin = await storage.getAdminByPin(pin);
    if (!admin) {
      console.log(`[Vercel Login] Admin not found for PIN: ${pin}`);
      return res.status(401).json({ message: "Invalid PIN or password" });
    }

    const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
    if (!isPasswordValid) {
      console.log(`[Vercel Login] Password mismatch for PIN: ${pin}`);
      return res.status(401).json({ message: "Invalid PIN or password" });
    }

    console.log(`[Vercel Login] Password verified for PIN: ${pin}, saving session...`);
    (req.session as any).isAdminLoggedIn = true;
    (req.session as any).adminId = admin.id;
    (req.session as any).adminPin = pin;
    
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        res.status(500).json({ message: "Session save failed", error: err.message });
      } else {
        res.json({ success: true });
      }
    });
  } catch (error: any) {
    console.error("[Vercel Login] Error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
}
