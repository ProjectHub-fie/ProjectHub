import { parse } from "cookie";
import { storage } from "../lib/storage.js";
import multer from 'multer';

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
  storage: multer.memoryStorage()
});

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Session');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      console.log('Profile GET request received');
      console.log('Headers:', {
        cookie: req.headers.cookie ? 'present' : 'missing',
        'x-user-session': req.headers['x-user-session'] ? 'present' : 'missing',
        authorization: req.headers.authorization ? 'present' : 'missing'
      });

      const cookies = parse(req.headers.cookie || '');
      let sessionToken = cookies['connect.sid'] || req.headers['x-user-session'];

      if (!sessionToken && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          sessionToken = authHeader.substring(7);
        }
      }

      console.log('Session token found:', !!sessionToken);

      if (!sessionToken) {
        console.log('No session token found, returning 401');
        return res.status(401).json({ user: null, message: "Authentication required" });
      }

      const decodedSession = Buffer.from(sessionToken, 'base64').toString();
      console.log('Decoded session:', decodedSession);
      
      const userData = JSON.parse(decodedSession);
      console.log('Parsed user data:', userData);
      
      const user = await storage.getUser(userData.id);
      console.log('Database user lookup:', user ? 'found' : 'not found');
      
      if (!user) {
        console.log('User not found in database');
        return res.status(401).json({ user: null, message: "User not found" });
      }

      const responseUser = { 
        id: user.id, 
        email: user.email, 
        firstName: user.firstName, 
        lastName: user.lastName, 
        profileImageUrl: user.profileImageUrl 
      };
      
      console.log('Returning user data');
      return res.json({ user: responseUser });
    }

    if (req.method === 'POST') {
      // Process multipart form data with multer
      await new Promise((resolve, reject) => {
        upload.single('file')(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      
      const cookies = parse(req.headers.cookie || '');
      let sessionToken = cookies['connect.sid'] || req.headers['x-user-session'];
      
      if (!sessionToken) return res.status(401).json({ message: "Authentication required" });
      
      const decodedSession = Buffer.from(sessionToken, 'base64').toString();
      const userData = JSON.parse(decodedSession);

      const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      const updatedUser = await storage.upsertUser({ id: userData.id, profileImageUrl: base64Image });
      return res.json({ user: { id: updatedUser.id, profileImageUrl: updatedUser.profileImageUrl } });
    }

    if (req.method === 'PATCH') {
      const cookies = parse(req.headers.cookie || '');
      let sessionToken = cookies['connect.sid'] || req.headers['x-user-session'];
      
      if (!sessionToken) return res.status(401).json({ message: "Authentication required" });
      
      const decodedSession = Buffer.from(sessionToken, 'base64').toString();
      const userData = JSON.parse(decodedSession);
      
      let body = {};
      if (req.headers['content-type']?.includes('application/json')) {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString());
      }

      const { firstName, lastName } = body;

      const updatedUser = await storage.upsertUser({ 
        id: userData.id, 
        firstName: firstName || undefined, 
        lastName: lastName || undefined 
      });
      
      return res.json({ 
        user: { 
          id: updatedUser.id, 
          email: updatedUser.email, 
          firstName: updatedUser.firstName, 
          lastName: updatedUser.lastName,
          profileImageUrl: updatedUser.profileImageUrl 
        } 
      });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error('Profile handler error:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
}