import type { NextApiRequest, NextApiResponse } from 'next';
import { registerRoutes } from '../../server/routes.js';

export const config = {
  api: {
    externalResolver: true,
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle API requests with Express
  const express = (await import('express')).default;
  const session = (await import('express-session')).default;
  const PostgresStoreModule = await import('connect-pg-simple');
  
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Trust proxy for Vercel
  app.set('trust proxy', 1);

  // CORS middleware - Fixed to allow specific origins instead of wildcard with credentials
  const allowedOrigins = [
    'http://localhost:5173',  // Vite dev server
    'http://localhost:3000',  // Next.js dev server
    'https://projecthub-fie.vercel.app',  // Replace with your actual Vercel domain
    'https://www.projecthub-fie.vercel.app',  // With www subdomain
    // Add your Vercel project domain here
  ];
  
  app.use((expressReq: any, expressRes: any, next: any) => {
    const origin = expressReq.headers.origin;
    if (!origin || allowedOrigins.includes(origin)) {
      expressRes.header('Access-Control-Allow-Origin', origin || allowedOrigins[0]);
    } else {
      // If origin is not in the allowed list, use the first allowed origin as fallback
      expressRes.header('Access-Control-Allow-Origin', allowedOrigins[0]);
    }
    
    expressRes.header('Access-Control-Allow-Credentials', 'true');
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
        secure: process.env.NODE_ENV === 'production', // Only secure in production
        sameSite: 'none', // Required for cross-origin requests
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