import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "../server/routes.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Trust proxy for Vercel
app.set('trust proxy', 1);

// Add CORS headers for Vercel
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Origin', req.headers.origin);
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
    secure: true, 
    sameSite: 'none',
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

export default async function handler(req: Request, res: Response) {
  // Ensure routes are registered
  await serverPromise;
  
  // Hand over to express
  return app(req, res);
}
