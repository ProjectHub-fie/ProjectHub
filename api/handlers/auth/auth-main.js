import { storage } from "../lib/storage.js";
import bcrypt from "bcryptjs";
import nc from "next-connect";

const handler = nc()
  .post(async (req, res) => {
    const { action } = req.query;

    if (action === 'register') {
      try {
        const { email, password, firstName, lastName, captchaToken } = req.body;
        if (!email || !password || !firstName || !lastName) {
          return res.status(400).json({ message: "All fields are required" });
        }
        // Captcha verification (reused logic)
        if (captchaToken && process.env.NODE_ENV === 'production') {
          const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
          const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${turnstileSecret}&response=${captchaToken}`
          });
          const verifyData = await verifyResponse.json();
          if (!verifyData.success) return res.status(400).json({ message: "Security verification failed" });
        }

        const existingUser = await storage.getUserByEmail(email);
        if (existingUser) return res.status(400).json({ message: "Email already registered" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await storage.upsertUser({ email, firstName, lastName, password: hashedPassword });
        const userData = { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName };
        const sessionToken = Buffer.from(JSON.stringify(userData)).toString('base64');
        const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
        res.setHeader('Set-Cookie', `connect.sid=${sessionToken}; Path=/; HttpOnly; SameSite=${isProd ? 'None' : 'Lax'}; ${isProd ? 'Secure;' : ''} Max-Age=86400`);
        return res.json({ user: userData, sessionToken });
      } catch (error) {
        return res.status(500).json({ message: "Registration failed" });
      }
    }

    if (action === 'login') {
      try {
        const { email, password, captchaToken } = req.body;
        if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
        // Captcha verification
        if (captchaToken && process.env.NODE_ENV === 'production') {
          const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
          const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${turnstileSecret}&response=${captchaToken}`
          });
          const verifyData = await verifyResponse.json();
          if (!verifyData.success) return res.status(400).json({ message: "Security verification failed" });
        }

        const user = await storage.getUserByEmail(email);
        if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
          return res.status(401).json({ message: "Invalid email or password" });
        }
        const userData = { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, profileImageUrl: user.profileImageUrl };
        const sessionToken = Buffer.from(JSON.stringify(userData)).toString('base64');
        const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
        res.setHeader('Set-Cookie', `connect.sid=${sessionToken}; Path=/; HttpOnly; SameSite=${isProd ? 'None' : 'Lax'}; ${isProd ? 'Secure;' : ''} Max-Age=86400`);
        return res.json({ user: userData, sessionToken });
      } catch (error) {
        return res.status(500).json({ message: "Login failed" });
      }
    }

    if (action === 'logout') {
      res.setHeader('Set-Cookie', 'connect.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      return res.json({ message: "Logged out successfully" });
    }

    res.status(400).json({ message: "Invalid action" });
  });

export default handler;