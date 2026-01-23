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
  .use(upload.single('file'))
  .post(async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Get userId from body (passed from frontend in Vercel mode)
      const { userId } = req.body;
      if (!userId) {
         return res.status(401).json({ message: "Authentication required" });
      }

      const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

      const updatedUser = await storage.upsertUser({
        id: userId,
        profileImageUrl: base64Image
      });

      res.json({
        user: {
          id: updatedUser.id,
          profileImageUrl: updatedUser.profileImageUrl
        }
      });
    } catch (error) {
      console.error('Vercel Upload error:', error);
      res.status(500).json({ message: "Failed to upload image" });
    }
  });

export default handler;
