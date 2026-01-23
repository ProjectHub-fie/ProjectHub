import { parse } from "cookie";
import { storage } from "../lib/storage.js";
import nc from "next-connect";

const handler = nc()
  .use((req, res, next) => {
    // Configure CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Session');
    next();
  })
  .options((req, res) => {
    res.status(200).end();
  })
  .get(async (req, res) => {
    const cookies = parse(req.headers.cookie || '');
    const sessionToken = cookies['connect.sid'];

    console.log('API Auth User - Token present:', !!sessionToken);

    if (!sessionToken) {
      return res.status(401).json({ user: null, message: "Authentication required" });
    }

    try {
      const decodedSession = Buffer.from(sessionToken, 'base64').toString();
      const userData = JSON.parse(decodedSession);
      if (!userData || typeof userData !== 'object' || !userData.id) {
        throw new Error("Malformed session data");
      }

      // Verify user exists in database
      const user = await storage.getUser(userData.id);
      if (!user) {
        return res.status(401).json({ user: null, message: "User not found" });
      }

      const responseUser = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl
      };

      console.log('API Auth User - Success:', user.email);
      res.json({ user: responseUser });
    } catch (e) {
      console.error('Session parsing error:', e);
      res.status(401).json({ user: null, message: "Invalid session" });
    }
  });

export default handler;
