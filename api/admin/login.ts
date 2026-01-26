import { type Request, Response } from "express";
import { storage } from "../../server/storage.js";
import bcrypt from "bcryptjs";

export default async function handler(req: Request, res: Response) {
  console.log('Login attempt received');
  if (req.method !== 'POST') {
    console.log(`Method ${req.method} not allowed`);
    return res.status(405).end();
  }
  
  const { username: pin, password } = req.body;
  console.log(`[Vercel Login] Attempting login for PIN: ${pin}`);
  
  try {
    const admin = await storage.getAdminByPin(pin);
    
    if (admin) {
      console.log(`[Vercel Login] Admin record found in admin_credentials table for PIN: ${pin}`);
      const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
      
      if (isPasswordValid) {
        console.log('Password verified successfully');
        (req.session as any).isAdminLoggedIn = true;
        return new Promise((resolve) => {
          req.session.save((err) => {
            if (err) {
              console.error("Session save error:", err);
              res.status(500).json({ message: "Session save failed", error: err.message });
              return resolve(true);
            }
            console.log('Session saved successfully');
            res.json({ success: true });
            resolve(true);
          });
        });
      } else {
        console.log('Password verification failed');
      }
    } else {
      console.log('No admin record found for this PIN');
    }
    
    res.status(401).json({ message: "Invalid PIN or password" });
  } catch (error: any) {
    console.error('Database or comparison error during login:', error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
}
