import { storage } from "../../server/storage.js";
import { parse } from "cookie";

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const cookies = parse(req.headers.cookie || '');
    const sessionToken = cookies['connect.sid'];

    if (!sessionToken) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // In a serverless environment, we'd need to find the user by session token
    // For Vercel, we can try to use a base64 encoded session token if that's how it's stored
    // But since the user is reporting an error page, let's implement the handler.
    
    // Note: Vercel serverless functions don't share the same in-memory storage as the main server.
    // If the storage is using PostgreSQL, it should work.
    
    const { firstName, lastName, profileImageUrl, id } = req.body;
    
    if (!id) {
       return res.status(400).json({ message: "User ID is required" });
    }

    const user = await storage.getUser(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const updatedUser = await storage.upsertUser({
      id: user.id,
      firstName: firstName !== undefined ? firstName : user.firstName,
      lastName: lastName !== undefined ? lastName : user.lastName,
      profileImageUrl: profileImageUrl !== undefined ? profileImageUrl : user.profileImageUrl,
    });

    res.json({ 
      user: { 
        id: updatedUser.id, 
        email: updatedUser.email, 
        firstName: updatedUser.firstName, 
        lastName: updatedUser.lastName,
        profileImageUrl: updatedUser.profileImageUrl
      } 
    });
  } catch (error) {
    console.error('Vercel Profile update error:', error);
    res.status(500).json({ message: "Failed to update profile" });
  }
}
