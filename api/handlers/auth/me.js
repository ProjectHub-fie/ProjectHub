import nc from "next-connect";

const handler = nc()
  .use((req, res, next) => {
    // Configure CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Session');
    next();
  })
  .options((req, res) => {
    res.status(200).end();
  })
  .get((req, res) => {
    // Check for user session token in headers (simple stateless auth for Vercel)
    const userSession = req.headers['x-user-session'];

    if (userSession) {
      try {
        // Simple decode - in production use proper JWT verification
        const userData = JSON.parse(Buffer.from(userSession, 'base64').toString());
        res.json({ user: userData });
      } catch (error) {
        res.status(401).json({ message: "Invalid session" });
      }
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });

export default handler;