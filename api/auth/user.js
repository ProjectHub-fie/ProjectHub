import { parse } from "cookie";

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const cookies = parse(req.headers.cookie || '');
    const sessionToken = cookies['connect.sid'];

    if (!sessionToken) {
      return res.status(401).json({ message: "Authentication required" });
    }

    try {
      const userData = JSON.parse(Buffer.from(sessionToken, 'base64').toString());
      res.json({ user: userData });
    } catch (e) {
      res.status(401).json({ message: "Invalid session" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
}
