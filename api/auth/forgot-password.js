
export default async function handler(req, res) {
  // Configure CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Generate reset token
      const crypto = await import('crypto');
      const resetToken = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 character alphanumeric code

      // Send reset email using Mailjet
      const Mailjet = (await import('node-mailjet')).default;
      const mailjet = Mailjet.apiConnect(
        process.env.MAILJET_API_KEY || '',
        process.env.MAILJET_API_SECRET || ''
      );

      const resetTokenLink = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/reset-password?token=${resetToken}`;
      
      await mailjet
        .post("send", { version: 'v3.1' })
        .request({
          Messages: [
            {
              From: {
                Email: process.env.EMAIL_USER || 'dev.projecthub.fie@gmail.com',
                Name: "ProjectHub"
              },
              To: [
                {
                  Email: email,
                  Name: email.split('@')[0]
                }
              ],
              Subject: "Password Reset Request",
              HTMLPart: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <h2 style="color: #3b82f6; margin-bottom: 20px;">Password Reset Request</h2>
                  <p>Hello,</p>
                  <p>You requested to reset your password for ProjectHub. Use the verification code below to complete the process:</p>
                  <div style="background-color: #f8fafc; padding: 15px; text-align: center; border-radius: 6px; margin: 25px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1e293b;">${resetToken}</span>
                  </div>
                  <p>Alternatively, click the button below to reset your password:</p>
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetTokenLink}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
                  </div>
                  <p style="color: #64748b; font-size: 14px;">This code will expire in 1 hour. If you didn't request this, please ignore this email.</p>
                  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;">
                  <p style="color: #94a3b8; font-size: 12px; text-align: center;">ProjectHub Security Team</p>
                </div>
              `
            }
          ]
        });

      // Store the token temporarily (in production, use a database)
      // For demo purposes, we'll just return success
      res.json({ message: "If an account with that email exists, you will receive a reset email" });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ message: "Failed to process password reset request" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
}
