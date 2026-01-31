import { type Request, Response } from "express";
import { storage } from "../../server/storage.js";
import bcrypt from "bcryptjs";

export default async function handler(req: Request, res: Response) {
  console.log('Login attempt received');
  if (req.method !== 'POST') {
    console.log(`Method ${req.method} not allowed`);
    return res.status(405).end();
  }
  
  const { pin, password } = req.body;
  console.log(`[Vercel Login] Attempting login for PIN: ${pin}`);
  
  try {
    // Check if any admins exist
    const allAdmins = await storage.getAllAdmins();
    console.log(`[Vercel Login] Current admin count: ${allAdmins.length}`);

    // Initial setup logic - allow default credentials when no admins exist
    if (allAdmins.length === 0) {
      if (pin === '1234' && password === 'admin123') {
        console.log("[Vercel Login] No admins found, allowing default setup login");
        (req.session as any).isAdminLoggedIn = true;
        (req.session as any).adminId = "setup";
        (req.session as any).adminPin = pin;
        
        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            res.status(500).json({ message: "Session save failed", error: err.message });
            return;
          }
          console.log('Session saved successfully for setup');
          res.json({ success: true, setup: true });
        });
        return;
      } else {
        console.log("[Vercel Login] No admins found, but default credentials not used");
        return res.status(401).json({ message: "No admins configured. Use PIN: 1234 and Password: admin123 for initial setup." });
      }
    }

    const admin = await storage.getAdminByPin(pin);
    
    if (admin) {
      console.log(`[Vercel Login] Admin record found in admin_credentials table for PIN: ${pin}`);
      const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
      
      if (isPasswordValid) {
        console.log('Password verified successfully');
        (req.session as any).isAdminLoggedIn = true;
        (req.session as any).adminId = admin.id;
        (req.session as any).adminPin = pin;
        
        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            res.status(500).json({ message: "Session save failed", error: err.message });
            return;
          }
          console.log('Session saved successfully');
          res.json({ success: true });
        });
      } else {
        console.log('Password verification failed');
        res.status(401).json({ message: "Invalid PIN or password" });
      }
    } else {
      console.log('No admin record found for this PIN');
      res.status(401).json({ message: "Invalid PIN or password" });
    }
    
  } catch (error: any) {
    console.error('Database or comparison error during login:', error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
}