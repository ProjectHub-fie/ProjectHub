/**
 * Simplified Vercel Edge Function handler
 * Optimized for Vercel's edge runtime
 */
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
    const url = new URL(req.url, `https://${req.headers.host}`);
    const path = url.pathname.replace(/^\/api/, '');
    const query = Object.fromEntries(url.searchParams);
    
    console.log('API Request:', { method: req.method, path, query });

    // Health check endpoint
    if (path === '/health') {
      return res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: {
          NODE_ENV: process.env.NODE_ENV || 'production',
          VERCEL: !!process.env.VERCEL,
          HAS_DATABASE_URL: !!process.env.DATABASE_URL,
          HAS_SESSION_SECRET: !!process.env.SESSION_SECRET,
        }
      });
    }

    // Debug endpoint
    if (path === '/debug/env') {
      return res.json({
        DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT_SET',
        SESSION_SECRET: process.env.SESSION_SECRET ? 'SET' : 'NOT_SET',
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        VERCEL_URL: process.env.VERCEL_URL,
        NODE_ENV: process.env.NODE_ENV,
        VERCEL: process.env.VERCEL,
      });
    }

    // Auth endpoints
    if (path === '/auth/register') {
      if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
      }
      
      const { email, password, firstName, lastName } = await parseBody(req);
      
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: 'All fields are required' });
      }

      // In a real app, you would handle registration here
      // For now, just return success
      return res.status(201).json({ 
        message: 'Registration would be processed in production',
        user: { email, firstName, lastName }
      });
    }

    if (path === '/auth/login') {
      if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
      }
      
      const { email, password } = await parseBody(req);
      
      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
      }

      // In a real app, you would verify credentials here
      return res.json({ 
        message: 'Login would be processed in production',
        user: { email, firstName: 'Test', lastName: 'User' }
      });
    }

    if (path === '/auth/me') {
      // In a real app, you'd verify the session/token here
      return res.json({ 
        user: null 
      });
    }

    // Projects endpoints
    if (path === '/projects') {
      if (req.method === 'GET') {
        // Return sample projects
        return res.json([
          {
            id: '1',
            title: 'Sample Project',
            description: 'This is a sample project',
            technologies: ['React', 'Node.js'],
            githubUrl: 'https://github.com/example/project',
            liveUrl: 'https://example.com'
          }
        ]);
      }
    }

    // Contact endpoint
    if (path === '/contact') {
      if (req.method === 'POST') {
        const data = await parseBody(req);
        console.log('Contact form submission:', data);
        return res.json({ message: 'Message sent successfully' });
      }
    }

    // No handler found
    return res.status(404).json({ message: 'API endpoint not found' });
    
  } catch (error) {
    console.error('API Handler Error:', error);
    return res.status(500).json({ 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Parse request body in a way that's compatible with edge runtime
 */
async function parseBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return {};
  }

  try {
    const contentType = req.headers['content-type'] || '';
    
    // Read the request body
    const buffer = await streamToBuffer(req.body);
    const bodyString = buffer.toString('utf-8');
    
    // Parse JSON body
    if (contentType.includes('application/json') && bodyString) {
      return JSON.parse(bodyString);
    }
    
    // Parse URL-encoded form data
    if (contentType.includes('application/x-www-form-urlencoded') && bodyString) {
      const params = new URLSearchParams(bodyString);
      const obj = {};
      for (const [key, value] of params) {
        obj[key] = value;
      }
      return obj;
    }
    
    return {};
  } catch (error) {
    console.warn('Error parsing request body:', error);
    return {};
  }
}

/**
 * Convert a readable stream to a buffer
 */
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}