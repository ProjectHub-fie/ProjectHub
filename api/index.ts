import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "../server/routes.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Trust proxy for Vercel
app.set('trust proxy', 1);

// Use a simple session
const session = (await import("express-session")).default;
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: true,
  saveUninitialized: true,
  proxy: true,
  cookie: { 
    secure: true, 
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true
  }
}));

// Initialize routes
const serverPromise = registerRoutes(app);

export default async function handler(req: Request, res: Response) {
  // Ensure routes are registered
  await serverPromise;
  
  // Hand over to express
  return app(req, res);
}
