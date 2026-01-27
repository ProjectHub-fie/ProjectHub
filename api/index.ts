import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "../server/routes.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Trust proxy for Vercel
app.set('trust proxy', 1);

// Add CORS headers for Vercel
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.header('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

// Use a simple session
const session = (await import("express-session")).default;
const PostgresStore = (await import("connect-pg-simple")).default(session);

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

// Add request logging for debugging
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[Vercel API] Incoming request: ${req.method} ${req.path}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[Vercel API] Finished request: ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Initialize routes
const serverPromise = registerRoutes(app);

// Serve static files from dist/public in production
if (process.env.NODE_ENV === 'production') {
  app.use('/', express.static(path.join(__dirname, '..', '..', 'dist', 'public'), {
    maxAge: '1y',
    etag: false
  }));
}

// Catch-all handler for client-side routing - AFTER API routes are registered
app.get('*', async (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api')) {
    return next();
  }
  
  // Wait for routes to be registered
  await serverPromise;
  
  // For all other routes, serve the React app
  res.setHeader('Content-Type', 'text/html');
  res.sendFile(path.join(__dirname, '..', '..', 'dist', 'public', 'index.html'));
});

export default async function handler(req: Request, res: Response) {
  // Ensure routes are registered
  await serverPromise;
  
  // Hand over to express
  return app(req, res);
}