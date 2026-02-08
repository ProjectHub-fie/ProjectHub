import contactMain from './handlers/contact-main.js';
import projectRequestsMain from './handlers/project-requests-main.js';
import projectsMain from './handlers/projects-main.js';
import authMain from './handlers/auth/auth-main.js';
import profileMain from './handlers/auth/profile-main.js';
import recoveryMain from './handlers/auth/recovery-main.js';
import bcrypt from 'bcryptjs';

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
  // Enable CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname.replace(/^\/api/, '');
    
    console.log('API Request:', { method: req.method, path, query: req.query });

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

    // Debug endpoints
    if (path === '/debug/env') {
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

    if (path === '/debug/auth') {
      try {
        // Test database connection
        const { storage } = await import('./lib/storage.js');
        let dbStatus = 'unknown';
        try {
          const testUser = await storage.getUserByEmail('test@example.com');
          dbStatus = testUser ? 'connected_with_data' : 'connected_no_data';
        } catch (dbError) {
          dbStatus = `error: ${dbError.message}`;
        }

        return res.json({
          environment: {
            NODE_ENV: process.env.NODE_ENV,
            VERCEL: !!process.env.VERCEL,
            HAS_DATABASE_URL: !!process.env.DATABASE_URL,
            HAS_SESSION_SECRET: !!process.env.SESSION_SECRET,
            NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
            VERCEL_URL: process.env.VERCEL_URL,
          },
          database: {
            status: dbStatus,
          },
          cookies: {
            connect_sid: req.headers.cookie?.includes('connect.sid') ? 'present' : 'missing',
            cookie_header: req.headers.cookie || 'none',
          },
          cors: {
            origin: req.headers.origin,
            allowed_origins: [process.env.NEXT_PUBLIC_APP_URL, process.env.VERCEL_URL].filter(Boolean),
          }
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    // Test user creation endpoint (development only)
    if (path === '/debug/create-test-user') {
      try {
        const { storage } = await import('./lib/storage.js');
        
        // Create a test user
        const hashedPassword = await bcrypt.hash('password123', 12);
        const testUser = await storage.upsertUser({
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          password: hashedPassword
        });

        return res.json({
          message: 'Test user created successfully',
          user: {
            id: testUser.id,
            email: testUser.email,
            firstName: testUser.firstName,
            lastName: testUser.lastName
          }
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    // Handle dynamic project routes
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

    // Handle registered handlers
    const h = handlers[path];
    if (h) {
      console.log('Handling request with registered handler');
      return h(req, res);
    }

    // No handler found
    console.log('No handler found for path:', path);
    return res.status(404).json({ message: 'API endpoint not found' });
    
  } catch (error) {
    console.error('API Handler Error:', error);
    return res.status(500).json({ 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}