import type { NextApiRequest, NextApiResponse } from 'next';
import { registerRoutes } from '../server/routes.js';
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
    return app(req as any, res as any);
  } else if (req.url?.startsWith('/assets/')) {
    // Serve static assets directly from dist/public/assets
    try {
      const assetUrl = req.url.split('?')[0]; // Remove query params
      const assetPath = path.join(process.cwd(), 'dist', 'public', assetUrl);
      const assetData = await fs.readFile(assetPath);
      
      // Basic content-type mapping
      if (assetUrl.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
      else if (assetUrl.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
      else if (assetUrl.endsWith('.jpg') || assetUrl.endsWith('.jpeg')) res.setHeader('Content-Type', 'image/jpeg');
      else if (assetUrl.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
      else if (assetUrl.endsWith('.gif')) res.setHeader('Content-Type', 'image/gif');
      else if (assetUrl.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
      else if (assetUrl.endsWith('.ico')) res.setHeader('Content-Type', 'image/x-icon');
      
      res.send(assetData);
    } catch (error) {
      console.error(`Error serving asset ${req.url}:`, error);
      res.status(404).send('Not Found');
    }
  } else {
    // Serve the React app for all other requests
    try {
      // Read the built index.html file
      const indexPath = path.join(process.cwd(), 'dist', 'public', 'index.html');
      const indexHtml = await fs.readFile(indexPath, 'utf8');
      
      res.setHeader('Content-Type', 'text/html');
      res.send(indexHtml);
    } catch (error) {
      console.error('Error serving index.html:', error);
      res.status(500).send('Internal Server Error');
    }
  }
}