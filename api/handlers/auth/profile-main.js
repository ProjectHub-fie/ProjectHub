import { parse } from "cookie";
import { storage } from "../lib/storage.js";
import multer from 'multer';
import nc from "next-connect";

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
  storage: multer.memoryStorage()
});

export const config = {
  api: {
    bodyParser: false,
  },
};

const handler = nc()
  .use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Session');
    next();
  })
  .options((req, res) => {
    res.status(200).end();
  })
  .get(async (req, res) => {
    // me/user logic
    const cookies = parse(req.headers.cookie || '');
    const sessionToken = cookies['connect.sid'] || req.headers['x-user-session'];

    if (!sessionToken) return res.status(401).json({ user: null, message: "Authentication required" });

    try {
      const decodedSession = Buffer.from(sessionToken, 'base64').toString();
      const userData = JSON.parse(decodedSession);
      const user = await storage.getUser(userData.id);
      if (!user) return res.status(401).json({ user: null, message: "User not found" });

      res.json({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, profileImageUrl: user.profileImageUrl } });
    } catch (e) {
      res.status(401).json({ user: null, message: "Invalid session" });
    }
  })
  .use(upload.single('file'))
  .post(async (req, res) => {
    // upload-profile-pic logic
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const { userId } = req.body;
      if (!userId) return res.status(401).json({ message: "Authentication required" });

      const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      const updatedUser = await storage.upsertUser({ id: userId, profileImageUrl: base64Image });
      res.json({ user: { id: updatedUser.id, profileImageUrl: updatedUser.profileImageUrl } });
    } catch (error) {
      res.status(500).json({ message: "Failed to upload image" });
    }
  });

export default handler;