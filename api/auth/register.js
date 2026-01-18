import { storage } from "../../server/storage.js";
import bcrypt from "bcryptjs";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { email, password, firstName, lastName, captchaToken } = req.body;
    
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await storage.upsertUser({
      email,
      firstName,
      lastName,
      password: hashedPassword,
    });

    const userData = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName
    };
    
    const sessionToken = Buffer.from(JSON.stringify(userData)).toString('base64');
    
    res.setHeader('Set-Cookie', `connect.sid=${sessionToken}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=86400`);
    res.json({
      user: userData,
      sessionToken: sessionToken
    });
  } catch (error) {
    console.error('API Register error:', error);
    res.status(500).json({ message: "Registration failed" });
  }
}
