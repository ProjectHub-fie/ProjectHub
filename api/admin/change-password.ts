import { type NextApiRequest, type NextApiResponse } from "next";
import { storage } from "../../server/storage.js";
import bcrypt from "bcryptjs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Check if admin is logged in via session
  if (!(req as any).session?.isAdminLoggedIn) {
    return res.status(401).json({ message: "Authentication required" });
  }
  
  try {
    const { id, currentPin, newPassword } = req.body;
    
    if (!id || !currentPin || !newPassword) {
      return res.status(400).json({ 
        message: "Admin ID, current PIN, and new password are required" 
      });
    }

    // 验证新密码强度 / Validate new password strength
    if (newPassword.length < 6) {
      return res.status(400).json({ 
        message: "New password must be at least 6 characters long" 
      });
    }

    // 获取管理员信息 / Get admin information
    const allAdmins = await storage.getAllAdmins();
    const targetAdmin = allAdmins.find(admin => admin.id === id);
    
    if (!targetAdmin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // 验证当前 PIN / Verify current PIN
    if (targetAdmin.pin !== currentPin) {
      return res.status(400).json({ message: "Current PIN does not match" });
    }

    // 加密新密码 / Hash new password
    const hash = await bcrypt.hash(newPassword, 10);
    
    // 更新管理员密码 / Update admin password
    await storage.setAdminPassword(currentPin, targetAdmin.email, hash);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: "Internal server error" });
  }
}