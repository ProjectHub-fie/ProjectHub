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

  try {
    app.use(session({
      store: new PostgresStore({
        conString: process.env.DATABASE_URL,
        tableName: 'sessions',
        createTableIfMissing: true  // Changed to true to auto-create if missing
      }),
      secret: process.env.SESSION_SECRET || 'fallback-secret-key-for-vercel',
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
  } catch (error) {
    console.error("Failed to initialize session store:", error);
    return res.status(500).json({ 
      message: "Session store initialization failed", 
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }

  // Initialize routes
  await registerRoutes(app);

  // Check if this is an API request
  if (req.url?.startsWith('/api/')) {
    // Handle API requests
    return app(req, res);
  } else {
    // Serve the React app for all other requests
    try {
      // Try to read the built index.html file from various possible locations
      let indexPath;
      let indexHtml;
      
      // Try different possible paths for Vercel deployment
      const possiblePaths = [
        path.join(process.cwd(), 'dist', 'public', 'index.html'),
        path.join(process.cwd(), '..', 'dist', 'public', 'index.html'),
        path.join(process.cwd(), 'public', 'index.html'),
        path.join(process.cwd(), '..', 'public', 'index.html'),
      ];
      
      for (const pathCandidate of possiblePaths) {
        try {
          indexHtml = await fs.readFile(pathCandidate, 'utf8');
          indexPath = pathCandidate;
          break;
        } catch (error) {
          continue; // Try next path
        }
      }
      
      if (indexHtml) {
        res.setHeader('Content-Type', 'text/html');
        res.send(indexHtml);
      } else {
        // If no built index.html is found, send a more informative response
        res.status(200).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>ProjectHub Application</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .login-box { max-width: 400px; margin: 20px auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #fafafa; }
              input, button { padding: 10px; margin: 5px 0; width: 100%; box-sizing: border-box; border-radius: 4px; border: 1px solid #ccc; }
              button { background-color: #0070f3; color: white; cursor: pointer; font-weight: bold; }
              button:hover { background-color: #0060d0; }
              h1 { color: #333; }
              h3 { color: #0070f3; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>ProjectHub Admin Dashboard</h1>
              <p>The application is running but requires authentication to access the UI.</p>
              
              <div class="login-box">
                <h3>Default Credentials:</h3>
                <p><strong>PIN:</strong> 131313</p>
                <p><strong>Password:</strong> adminpassword</p>
                <p>This is a security feature - the UI requires authentication.</p>
                
                <h4>Deployment Notes:</h4>
                <p>Make sure you have:</p>
                <ol style="text-align: left; margin: 15px 0;">
                  <li>Set DATABASE_URL in your Vercel environment variables</li>
                  <li>Set SESSION_SECRET in your Vercel environment variables</li>
                  <li>Run database migrations with 'npm run db:push'</li>
                  <li>Created an admin account in your production database</li>
                </ol>
              </div>
              
              <p>If you're seeing this page, the server is running correctly!</p>
            </div>
          </body>
          </html>
        `);
      }
    } catch (error) {
      console.error('Unexpected error serving application:', error);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Server Error - ProjectHub</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Server Error</h1>
            <p>An error occurred while loading the application.</p>
            
            <h3>Possible Causes:</h3>
            <ul style="text-align: left;">
              <li>Missing environment variables (DATABASE_URL, SESSION_SECRET)</li>
              <li>Database connection issues</li>
              <li>Build assets not properly deployed</li>
            </ul>
            
            <p>Please check your Vercel deployment logs and configuration.</p>
          </div>
        </body>
        </html>
      `);
    }
  }
}