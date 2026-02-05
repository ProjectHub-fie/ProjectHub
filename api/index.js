import contactMain from './handlers/contact-main.js';
import projectRequestsMain from './handlers/project-requests-main.js';
import projectsMain from './handlers/projects-main.js';
import authMain from './handlers/auth/auth-main.js';
import profileMain from './handlers/auth/profile-main.js';
import recoveryMain from './handlers/auth/recovery-main.js';

const handlers = {
  '/contact': contactMain,
  '/project-requests': projectRequestsMain,
  '/projects': projectsMain,
  '/auth/login': (req, res) => { req.query.action = 'login'; return authMain(req, res); },
  '/auth/register': (req, res) => { req.query.action = 'register'; return authMain(req, res); },
  '/auth/logout': (req, res) => { req.query.action = 'logout'; return authMain(req, res); },
  '/auth/user': profileMain,
  '/auth/me': profileMain,
  '/auth/upload-profile-pic': profileMain,
  '/auth/forgot-password': (req, res) => { req.query.action = 'forgot'; return recoveryMain(req, res); },
  '/auth/reset-password': (req, res) => { req.query.action = 'reset'; return recoveryMain(req, res); },
};

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api/, '');

  // Health check endpoint
  if (path === '/health') {
    return res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        VERCEL: !!process.env.VERCEL,
        DATABASE_URL: !!process.env.DATABASE_URL,
        SESSION_SECRET: !!process.env.SESSION_SECRET,
      }
    });
  }

  // Debug endpoint for environment variables (only in development)
  if (path === '/debug/env' && process.env.NODE_ENV === 'development') {
    return res.json({
      DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT_SET',
      SESSION_SECRET: process.env.SESSION_SECRET ? 'SET' : 'NOT_SET',
      RESEND_API_KEY: process.env.RESEND_API_KEY ? 'SET' : 'NOT_SET',
      TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ? 'SET' : 'NOT_SET',
      DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID ? 'SET' : 'NOT_SET',
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      VERCEL_URL: process.env.VERCEL_URL,
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
    });
  }

  if (path.startsWith('/projects/')) {
    const parts = path.split('/');
    if (parts.length >= 3) {
      if (parts[parts.length - 1] === 'interactions') {
        req.query.projectId = parts[2];
        return projectsMain(req, res);
      }
      req.query.projectId = parts[2];
      return projectsMain(req, res);
    }
  }

  const h = handlers[path];
  if (h) return h(req, res);

  res.status(404).json({ message: 'API endpoint not found' });
}