import nc from "next-connect";
import { storage } from "../lib/storage.js";

const handler = nc()
  .use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  })
  .options((req, res) => {
    res.status(200).end();
  })
  .post(async (req, res) => {
    const { action } = req.query;

    if (action === 'forgot') {
      try {
        const { email, captchaToken } = req.body;
        if (!email) return res.status(400).json({ message: "Email is required" });

        if (captchaToken && process.env.NODE_ENV === 'production') {
          const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
          const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=\${turnstileSecret}&response=\${captchaToken}`
          });
          const verifyData = await verifyResponse.json();
          if (!verifyData.success) return res.status(400).json({ message: "Security verification failed" });
        }

        const user = await storage.getUserByEmail(email);
        if (!user) return res.json({ message: "Password reset email sent" });

        const { randomBytes } = await import("crypto");
        const resetToken = randomBytes(3).toString('hex').toUpperCase();
        const resetTokenExpiry = new Date(Date.now() + 3600000);

        await storage.updateUserResetToken(user.id, resetToken, resetTokenExpiry);

        const Mailjet = (await import('node-mailjet')).default;
        const mailjet = Mailjet.apiConnect(process.env.MAILJET_API_KEY || '', process.env.MAILJET_API_SECRET || '');

        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host;
        const resetTokenLink = `\${protocol}://\${host}/reset-password?token=\${resetToken}`;

        await mailjet.post("send", { version: 'v3.1' }).request({
          Messages: [{
            From: { Email: process.env.EMAIL_USER || 'dev.projecthub.fie@gmail.com', Name: "ProjectHub" },
            To: [{ Email: email, Name: user.firstName || '' }],
            Subject: "Password Reset Request",
            HTMLPart: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #3b82f6; margin-bottom: 20px;">Password Reset Request</h2>
                <p>Hello \${user.firstName},</p>
                <p>You requested to reset your password for ProjectHub. Use the verification code below to complete the process:</p>
                <div style="background-color: #f8fafc; padding: 15px; text-align: center; border-radius: 6px; margin: 25px 0;">
                  <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1e293b;">\${resetToken}</span>
                </div>
                <p>Alternatively, click the button below to reset your password:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="\${resetTokenLink}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
                </div>
                <p style="color: #64748b; font-size: 14px;">This code will expire in 1 hour. If you didn't request this, please ignore this email.</p>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;">
                <p style="color: #94a3b8; font-size: 12px; text-align: center;">ProjectHub Security Team</p>
              </div>
            `
          }]
        });

        return res.json({ message: "Password reset email sent" });
      } catch (error) {
        return res.status(500).json({ message: "Failed to process reset request" });
      }
    }

    if (action === 'reset') {
      try {
        const { token, newPassword, captchaToken } = req.body;
        if (!token || !newPassword) return res.status(400).json({ message: "Token and new password are required" });

        if (captchaToken && process.env.NODE_ENV === 'production') {
          const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
          const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=\${turnstileSecret}&response=\${captchaToken}`
          });
          const verifyData = await verifyResponse.json();
          if (!verifyData.success) return res.status(400).json({ message: "Security verification failed" });
        }

        const user = await storage.getUserByResetToken(token);
        if (!user || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
          return res.status(400).json({ message: "Invalid or expired reset token" });
        }

        const bcrypt = (await import('bcryptjs')).default;
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await storage.resetUserPassword(user.id, hashedPassword);

        return res.json({ message: "Password reset successfully" });
      } catch (error) {
        return res.status(500).json({ message: "Failed to reset password" });
      }
    }

    res.status(400).json({ message: "Invalid action" });
  });

export default handler;
