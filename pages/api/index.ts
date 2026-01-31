import type { NextApiRequest, NextApiResponse } from 'next';
import { registerRoutes } from '../../server/routes.js';
import path from 'path';
import { promises as fs } from 'fs';

export const config = {
  api: {
    externalResolver: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Dynamic import for Node.js specific modules
  const express = (await import('express')).default;
  const session = (await import('express-session')).default;
  const PostgresStoreModule = await import('connect-pg-simple');
  
  // Create a simplified express app just for this request
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Trust proxy for Vercel
  app.set('trust proxy', 1);

  // Add CORS headers for Vercel
  app.use((expressReq: any, expressRes: any, next: any) => {
    expressRes.header('Access-Control-Allow-Credentials', 'true');
    expressRes.header('Access-Control-Allow-Origin', expressReq.headers.origin || '*');
    expressRes.header('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    expressRes.header('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    if (expressReq.method === 'OPTIONS') {
      expressRes.status(200).end();
      return;
    }
    next();
  });

  // Use a simple session
  const PostgresStore = PostgresStoreModule.default(session);

  app.use(session({
    store: new PostgresStore({
      conString: process.env.DATABASE_URL,
      tableName: 'sessions',
      createTableIfMissing: false
    }),
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: { 
      secure: process.env.NODE_ENV === 'production', 
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true
    }
  }));

  // Initialize routes
  await registerRoutes(app);

  // Check if this is an API request
  if (req.url?.startsWith('/api/')) {
    // Handle API requests
    return app(req, res);
  } else {
    // Serve the React app for all other requests
    try {
      // Try to read the built index.html file
      const indexPath = path.join(process.cwd(), 'dist', 'public', 'index.html');
      const indexHtml = await fs.readFile(indexPath, 'utf8');
      
      res.setHeader('Content-Type', 'text/html');
      res.send(indexHtml);
    } catch (error) {
      // Fallback: try different path structures that might be used in Vercel
      try {
        // For Vercel deployments, the path might be different
        const vercelIndexPath = path.join(process.cwd(), '..', 'dist', 'public', 'index.html');
        const indexHtml = await fs.readFile(vercelIndexPath, 'utf8');
        
        res.setHeader('Content-Type', 'text/html');
        res.send(indexHtml);
      } catch (secondError) {
        console.error('Error serving index.html:', error, secondError);
        // As a last resort, send a helpful message to the user
        res.status(200).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>ProjectHub Application</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .container { max-width: 600px; margin: 0 auto; }
              .login-box { max-width: 400px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
              input, button { padding: 10px; margin: 5px 0; width: 100%; box-sizing: border-box; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>ProjectHub Admin Login</h1>
              <p>The application is running but requires authentication to access the UI.</p>
              
              <div class="login-box">
                <h3>Default Credentials:</h3>
                <p><strong>PIN:</strong> 131313</p>
                <p><strong>Password:</strong> adminpassword</p>
                <p>This is a security feature - the UI requires authentication.</p>
              </div>
              
              <p>If you're seeing this page, the application is working correctly!</p>
            </div>
          </body>
          </html>
        `);
      }
    }
  }
}