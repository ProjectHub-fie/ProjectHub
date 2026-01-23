
import nc from "next-connect";

const handler = nc()
  .use((req, res, next) => {
    // Configure CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  })
  .options((req, res) => {
    res.status(200).end();
  })
  .post(async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      // In a real implementation, you would:
      // 1. Validate the token against your database
      // 2. Check if it's not expired
      // 3. Update the user's password in the database

      // For demo purposes, we'll just return success
      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

export default handler;
