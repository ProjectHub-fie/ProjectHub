import { type Request, Response } from "express";
import { storage } from "../../server/storage.js";
import bcrypt from "bcryptjs";

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).end();
  
  try {
    const { pin, password } = req.body;
    const admin = await storage.getAdminByPin(pin);
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      return res.status(401).json({ message: "Invalid PIN or password" });
    }

    (req.session as any).isAdminLoggedIn = true;
    (req.session as any).adminId = admin.id;
    (req.session as any).adminRole = admin.role;
    
    req.session.save(() => res.json({ 
      success: true,
      role: admin.role,
      message: "Login successful"
    }));
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
}