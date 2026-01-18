import { storage } from "../../server/storage.js";
import bcrypt from "bcryptjs";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { email, password, captchaToken } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Verify captcha if needed
    if (captchaToken && process.env.NODE_ENV === 'production') {
      const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
      try {
        const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `secret=${turnstileSecret}&response=${captchaToken}`
        });
        const verifyData = await verifyResponse.json();
        if (!verifyData.success) {
          console.error('Turnstile verification failed:', verifyData);
          return res.status(400).json({ message: "Security verification failed" });
        }
      } catch (verifyError) {
        console.error('Turnstile fetch error:', verifyError);
      }
    } else if (captchaToken) {
      console.log('Skipping Turnstile verification in development');
    }

    const user = await storage.getUserByEmail(email);
    if (!user || !user.password) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const userData = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl
    };
    
    // Simple session token
    const sessionToken = Buffer.from(JSON.stringify(userData)).toString('base64');
    
    // Set cookie and also return it in response for development convenience
    const isProd = process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', `connect.sid=${sessionToken}; Path=/; HttpOnly; SameSite=${isProd ? 'None' : 'Lax'}; ${isProd ? 'Secure;' : ''} Max-Age=86400`);
    res.json({
      user: userData,
      sessionToken: sessionToken
    });
  } catch (error) {
    console.error('API Login error:', error);
    res.status(500).json({ message: "Login failed" });
  }
}
