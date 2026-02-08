import { storage } from "../../lib/storage.ts";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

export default async function handler(req, res) {
  const action = req.query.action;

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ message: "Method not allowed" });
    }

    // Parse body
    let body = {};
    if (req.headers['content-type']?.includes('application/json')) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString());
    }

    if (action === 'forgot') {
      const { email } = body;
      if (!email) return res.status(400).json({ message: "Email is required" });

      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(404).json({ message: "User not found" });

      // Generate reset token
      const resetToken = randomBytes(32).toString('hex');
      const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

      await storage.updateUserResetToken(user.id, resetToken, resetTokenExpiry);

      // In a real app, you'd send an email here
      console.log(`Reset token for ${email}: ${resetToken}`);

      return res.json({ message: "Password reset instructions sent to your email" });
    }

    if (action === 'reset') {
      const { token, newPassword } = body;
      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }

      const user = await storage.getUserByResetToken(token);
      if (!user) return res.status(400).json({ message: "Invalid or expired reset token" });

      if (user.resetTokenExpiry && user.resetTokenExpiry < new Date()) {
        return res.status(400).json({ message: "Reset token has expired" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await storage.resetUserPassword(user.id, hashedPassword);

      return res.json({ message: "Password reset successfully" });
    }

    return res.status(400).json({ message: "Invalid action" });
  } catch (error) {
    console.error('Recovery handler error:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
