import type { NextApiRequest, NextApiResponse } from 'next';
import { registerRoutes } from '../../server/routes.js';
import path from 'path';
import { promises as fs } from 'fs';

export const config = {
  api: {
    externalResolver: true,
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check if this is a static file request (not API)
  const url = req.url || '/';
  
  // If it's not an API route, serve static files
  if (!url.startsWith('/api/')) {
    try {
      // Build the path to the static file
      const filePath = path.join(process.cwd(), 'dist', 'public', url === '/' ? 'index.html' : url);
      
      // Check if file exists
      await fs.access(filePath);
      
      // Get file extension to set proper content type
      const ext = path.extname(filePath).toLowerCase();
      const contentTypeMap: { [key: string]: string } = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject',
      };
      
      const contentType = contentTypeMap[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      
      // Serve the file
      const fileContent = await fs.readFile(filePath);
      res.status(200).send(fileContent);
      return;
    } catch (error) {
      // File not found, serve index.html for SPA routing
      try {
        const indexPath = path.join(process.cwd(), 'dist', 'public', 'index.html');
        const indexContent = await fs.readFile(indexPath);
        res.setHeader('Content-Type', 'text/html');
        res.status(200).send(indexContent);
        return;
      } catch (indexError) {
        console.error('Failed to serve index.html:', indexError);
        res.status(500).json({ message: "Failed to serve application" });
        return;
      }
    }
  }

  // Handle API requests with Express
  const express = (await import('express')).default;
  const session = (await import('express-session')).default;
  const PostgresStoreModule = await import('connect-pg-simple');
  
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Trust proxy for Vercel
  app.set('trust proxy', 1);

  // CORS middleware
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

  const PostgresStore = PostgresStoreModule.default(session);

  try {
    app.use(session({
      store: new PostgresStore({
        conString: process.env.DATABASE_URL,
        tableName: 'sessions',
        createTableIfMissing: true
      }),
      secret: process.env.SESSION_SECRET || 'fallback-secret-key-for-vercel',
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: { 
        secure: true, 
        sameSite: 'none',
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true
      }
    }));
  } catch (error) {
    console.error("Failed to initialize session store:", error);
    return res.status(500).json({ message: "Session store initialization failed" });
  }

  await registerRoutes(app);

  // Handle the API request with Express
  return app(req, res);
}