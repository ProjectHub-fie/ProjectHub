import { parse } from "cookie";

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const cookies = parse(req.headers.cookie || '');
    const sessionToken = cookies['connect.sid'];

    if (!sessionToken) {
      return res.status(401).json({ message: "Authentication required" });
    }

    try {
      const decodedSession = Buffer.from(sessionToken, 'base64').toString();
      const userData = JSON.parse(decodedSession);
      if (!userData || typeof userData !== 'object') {
        throw new Error("Malformed session data");
      }
      res.json({ user: userData });
    } catch (e) {
      console.error('Session parsing error:', e, 'Token snippet:', sessionToken?.substring(0, 10));
      res.status(401).json({ message: "Invalid session" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
}
