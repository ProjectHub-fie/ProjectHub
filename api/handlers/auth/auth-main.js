import bcrypt from "bcryptjs";
import { storage } from "../../lib/storage.js";

async function handler(req, res) {
  const action = req.query.action;

  // Enable CORS for all origins in development, specific origins in production
  const isDev = process.env.NODE_ENV === 'development';
  const origin = req.headers.origin;
  const allowedOrigins = isDev 
    ? '*' 
    : [process.env.NEXT_PUBLIC_APP_URL, process.env.VERCEL_URL].filter(Boolean);

  res.setHeader('Access-Control-Allow-Origin', isDev ? '*' : (allowedOrigins.includes(origin) ? origin : 'null'));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Parse body for POST requests
  let body = {};
  if (req.method === 'POST' && req.headers['content-type']?.includes('application/json')) {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch (error) {
      return res.status(400).json({ message: "Invalid JSON body" });
    }
  }

  if (action === 'register') {
    try {
      const { email, password, firstName, lastName, captchaToken } = body;
      
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: "All fields are required" });
      }

      // Captcha verification for production
      if (captchaToken && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY;
        if (turnstileSecret) {
          try {
            const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `secret=${turnstileSecret}&response=${captchaToken}`
            });
            const verifyData = await verifyResponse.json();
            if (!verifyData.success) {
              return res.status(400).json({ message: "Security verification failed" });
            }
          } catch (error) {
            console.error('Captcha verification error:', error);
            return res.status(500).json({ message: "Security verification failed" });
          }
        }
      }

      // Check if user exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Create user
      const user = await storage.upsertUser({
        email,
        password: hashedPassword,
        firstName,
        lastName
      });

      // Create session token
      const userData = { 
        id: user.id, 
        email: user.email, 
        firstName: user.firstName, 
        lastName: user.lastName 
      };
      const sessionToken = Buffer.from(JSON.stringify(userData)).toString('base64');
      
      // Set cookie with proper attributes for Vercel
      const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
      const cookieOptions = [
        `connect.sid=${sessionToken}`,
        'Path=/', 
        'HttpOnly', 
        `SameSite=${isProd ? 'None' : 'Lax'}`, 
        isProd ? 'Secure' : '', 
        'Max-Age=86400'
      ].filter(Boolean).join('; ');
      
      res.setHeader('Set-Cookie', cookieOptions);
      
      return res.status(201).json({ user: userData });
    } catch (error) {
      console.error('Registration error:', error);
      return res.status(500).json({ message: "Registration failed" });
    }
  }

  if (action === 'login') {
    try {
      const { email, password, captchaToken } = body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      // Captcha verification for production
      if (captchaToken && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
        const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || process.env.VITE_TURNSTILE_SECRET_KEY;
        if (turnstileSecret) {
          try {
            const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `secret=${turnstileSecret}&response=${captchaToken}`
            });
            const verifyData = await verifyResponse.json();
            if (!verifyData.success) {
              return res.status(400).json({ message: "Security verification failed" });
            }
          } catch (error) {
            console.error('Captcha verification error:', error);
            return res.status(500).json({ message: "Security verification failed" });
          }
        }
      }

      const user = await storage.getUserByEmail(email);
      if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      if (user.isBlocked) {
        return res.status(403).json({ message: "Your account has been blocked" });
      }

      const userData = { 
        id: user.id, 
        email: user.email, 
        firstName: user.firstName, 
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl 
      };
      
      // Create session token
      const sessionToken = Buffer.from(JSON.stringify(userData)).toString('base64');
      
      // Set cookie with proper attributes for Vercel
      const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
      const cookieOptions = [
        `connect.sid=${sessionToken}`,
        'Path=/',
        'HttpOnly',
        `SameSite=${isProd ? 'None' : 'Lax'}`,
        isProd ? 'Secure' : '',
        'Max-Age=86400'
      ].filter(Boolean).join('; ');
      
      res.setHeader('Set-Cookie', cookieOptions);
      
      return res.json({ user: userData, sessionToken });
    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({ message: "Login failed" });
    }
  }

  if (action === 'logout') {
    try {
      const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
      const cookieOptions = [
        'connect.sid=',
        'Path=/',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'HttpOnly',
        `SameSite=${isProd ? 'None' : 'Lax'}`,
        isProd ? 'Secure' : ''
      ].filter(Boolean).join('; ');
      
      res.setHeader('Set-Cookie', cookieOptions);
      return res.json({ message: "Logged out successfully" });
    } catch (error) {
      console.error('Logout error:', error);
      return res.status(500).json({ message: "Logout failed" });
    }
  }

  return res.status(400).json({ message: "Invalid action" });
}

export default handler;