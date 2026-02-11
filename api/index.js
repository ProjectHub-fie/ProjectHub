/**
 * Comprehensive Vercel Edge Function handler
 * Implements all required API endpoints for ProjectHub frontend with database integration
 */
import { DatabaseStorage } from './lib/storage.js';
import bcrypt from 'bcryptjs';

// Initialize database storage
const storage = new DatabaseStorage();

export default async function handler(request, response) {
  const url = new URL(request.url, `https://${request.headers.host}`);
  const path = url.pathname;
  const searchParams = url.searchParams;

  // Enable CORS for all API endpoints
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Session');
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  try {
    // Health check endpoint
    if (path === '/api/health') {
      return response.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        message: 'API is functioning properly'
      });
    }

    // Password recovery endpoint (handle this before auth endpoints)
    if (path === '/api/auth/recovery') {
      return handleRecoveryEndpoint(request, response, searchParams);
    }

    // Auth endpoints
    if (path.startsWith('/api/auth/')) {
      return handleAuthEndpoints(request, response, path);
    }

    // Project requests endpoint
    if (path === '/api/project-requests') {
      return handleProjectRequestsEndpoint(request, response);
    }

    // Contact endpoint
    if (path === '/api/contact') {
      return handleContactEndpoint(request, response);
    }

    // Projects endpoints
    if (path.startsWith('/api/projects/')) {
      return handleProjectsEndpoints(request, response, path);
    }

    // Auth callback handler
    if (path === '/api/auth/callback') {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      if (error) {
        return response.redirect(`/login?error=${encodeURIComponent(error)}`);
      }

      if (!code) {
        return response.redirect('/login?error=missing_code');
      }

      const redirectUrl = `/login?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
      return response.redirect(redirectUrl);
    }

    // Reset password handler
    if (path === '/reset-password') {
      const token = searchParams.get('token');
      const redirectUrl = `/reset-password${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      return response.redirect(redirectUrl);
    }

    // Catch-all for unsupported endpoints
    return response.status(404).json({ 
      message: "Endpoint not found",
      path: path,
      availableEndpoints: [
        "GET /api/health",
        "POST /api/auth/login",
        "POST /api/auth/register", 
        "POST /api/auth/logout",
        "GET /api/auth/me",
        "PATCH /api/auth/user",
        "POST /api/project-requests",
        "GET /api/project-requests",
        "POST /api/contact",
        "POST /api/projects/{id}/interactions",
        "POST /api/auth/recovery?action=forgot",
        "POST /api/auth/recovery?action=reset"
      ]
    });

  } catch (error) {
    console.error('API handler error:', error);
    return response.status(500).json({ 
      message: "Internal server error",
      error: error.message 
    });
  }
}

// Handle authentication-related endpoints with database integration
async function handleAuthEndpoints(request, response, path) {
  const endpoint = path.replace('/api/auth/', '');
  
  switch (endpoint) {
    case 'me':
      if (request.method === 'GET') {
        // Check for session token
        const sessionToken = request.headers['x-user-session'];
        if (sessionToken) {
          try {
            // Decode session token to get user ID
            const decodedSession = Buffer.from(sessionToken, 'base64').toString();
            const userData = JSON.parse(decodedSession);
            const userId = userData.id;
            
            if (userId) {
              const user = await storage.getUser(userId);
              if (user) {
                return response.status(200).json({
                  user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    profileImageUrl: user.profileImageUrl
                  }
                });
              }
            }
          } catch (e) {
            console.log('Invalid session token');
          }
        }
        return response.status(401).json({ message: 'Not authenticated' });
      }
      break;

    case 'login':
      if (request.method === 'POST') {
        let body = {};
        if (request.headers['content-type']?.includes('application/json')) {
          const chunks = [];
          for await (const chunk of request) {
            chunks.push(chunk);
          }
          body = JSON.parse(Buffer.concat(chunks).toString());
        }

        const { email, password } = body;
        
        if (!email || !password) {
          return response.status(400).json({ message: 'Email and password are required' });
        }

        try {
          const user = await storage.getUserByEmail(email);
          if (user && user.password) {
            // Verify password
            const isValidPassword = await bcrypt.compare(password, user.password);
            if (isValidPassword) {
              // Create session token
              const sessionData = {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName
              };
              const sessionToken = Buffer.from(JSON.stringify(sessionData)).toString('base64');
              
              return response.status(200).json({
                user: {
                  id: user.id,
                  email: user.email,
                  firstName: user.firstName,
                  lastName: user.lastName,
                  profileImageUrl: user.profileImageUrl
                },
                sessionToken: sessionToken
              });
            }
          }
          
          return response.status(401).json({ message: 'Invalid credentials' });
        } catch (error) {
          console.error('Login error:', error);
          return response.status(500).json({ message: 'Login failed' });
        }
      }
      break;

    case 'register':
      if (request.method === 'POST') {
        let body = {};
        if (request.headers['content-type']?.includes('application/json')) {
          const chunks = [];
          for await (const chunk of request) {
            chunks.push(chunk);
          }
          body = JSON.parse(Buffer.concat(chunks).toString());
        }

        const { email, password, firstName, lastName } = body;
        
        if (!email || !password || !firstName || !lastName) {
          return response.status(400).json({ message: 'All fields are required' });
        }

        try {
          // Check if user already exists
          const existingUser = await storage.getUserByEmail(email);
          if (existingUser) {
            return response.status(400).json({ message: 'User already exists' });
          }

          // Hash password
          const hashedPassword = await bcrypt.hash(password, 12);
          
          // Create new user
          const newUser = await storage.upsertUser({
            email,
            firstName,
            lastName,
            password: hashedPassword
          });

          // Create session token
          const sessionData = {
            id: newUser.id,
            email: newUser.email,
            firstName: newUser.firstName,
            lastName: newUser.lastName
          };
          const sessionToken = Buffer.from(JSON.stringify(sessionData)).toString('base64');
          
          return response.status(201).json({
            user: {
              id: newUser.id,
              email: newUser.email,
              firstName: newUser.firstName,
              lastName: newUser.lastName,
              profileImageUrl: newUser.profileImageUrl
            },
            sessionToken: sessionToken
          });
        } catch (error) {
          console.error('Registration error:', error);
          return response.status(500).json({ message: 'Registration failed' });
        }
      }
      break;

    case 'logout':
      if (request.method === 'POST') {
        return response.status(200).json({ message: 'Logged out successfully' });
      }
      break;

    case 'user':
      if (request.method === 'PATCH') {
        let body = {};
        if (request.headers['content-type']?.includes('application/json')) {
          const chunks = [];
          for await (const chunk of request) {
            chunks.push(chunk);
          }
          body = JSON.parse(Buffer.concat(chunks).toString());
        }

        // Check for session token
        const sessionToken = request.headers['x-user-session'];
        if (!sessionToken) {
          return response.status(401).json({ message: 'Not authenticated' });
        }

        try {
          // Decode session token to get user ID
          const decodedSession = Buffer.from(sessionToken, 'base64').toString();
          const userData = JSON.parse(decodedSession);
          const userId = userData.id;
          
          if (!userId) {
            return response.status(401).json({ message: 'Not authenticated' });
          }

          // Update user
          const updatedUser = await storage.upsertUser({
            id: userId,
            firstName: body.firstName,
            lastName: body.lastName,
            profileImageUrl: body.profileImageUrl
          });

          return response.status(200).json({
            user: {
              id: updatedUser.id,
              email: updatedUser.email,
              firstName: updatedUser.firstName,
              lastName: updatedUser.lastName,
              profileImageUrl: updatedUser.profileImageUrl
            }
          });
        } catch (error) {
          console.error('Profile update error:', error);
          return response.status(500).json({ message: 'Failed to update profile' });
        }
      }
      break;

    default:
      return response.status(404).json({ message: 'Auth endpoint not found' });
  }

  return response.status(405).json({ message: 'Method not allowed' });
}

// Handle project requests endpoint with database integration
async function handleProjectRequestsEndpoint(request, response) {
  if (request.method === 'GET') {
    // Check for session token to get user's requests
    const sessionToken = request.headers['x-user-session'];
    if (!sessionToken) {
      return response.status(401).json({ message: 'Not authenticated' });
    }

    try {
      // Decode session token to get user ID
      const decodedSession = Buffer.from(sessionToken, 'base64').toString();
      const userData = JSON.parse(decodedSession);
      const userId = userData.id;
      
      if (!userId) {
        return response.status(401).json({ message: 'Not authenticated' });
      }

      const requests = await storage.getProjectRequests(userId);
      return response.status(200).json(requests);
    } catch (error) {
      console.error('Get project requests error:', error);
      return response.status(500).json({ message: 'Failed to fetch project requests' });
    }
  }

  if (request.method === 'POST') {
    let body = {};
    if (request.headers['content-type']?.includes('application/json')) {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString());
    }

    const { title, description, budget, timeline, technologies } = body;

    // Validate required fields
    if (!title || !description) {
      return response.status(400).json({ message: 'Title and description are required' });
    }

    // Check for session token
    const sessionToken = request.headers['x-user-session'];
    if (!sessionToken) {
      return response.status(401).json({ message: 'Not authenticated' });
    }

    try {
      // Decode session token to get user ID
      const decodedSession = Buffer.from(sessionToken, 'base64').toString();
      const userData = JSON.parse(decodedSession);
      const userId = userData.id;
      
      if (!userId) {
        return response.status(401).json({ message: 'Not authenticated' });
      }

      // Create project request
      const projectRequest = await storage.createProjectRequest({
        userId: userId,
        title,
        description,
        budget: budget || null,
        timeline: timeline || null,
        technologies: technologies || []
      });

      return response.status(201).json(projectRequest);
    } catch (error) {
      console.error('Create project request error:', error);
      return response.status(500).json({ message: 'Failed to create project request' });
    }
  }

  return response.status(405).json({ message: 'Method not allowed' });
}

// Handle contact endpoint
async function handleContactEndpoint(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ message: 'Method not allowed' });
  }

  let body = {};
  if (request.headers['content-type']?.includes('application/json')) {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    body = JSON.parse(Buffer.concat(chunks).toString());
  }

  const { name, email, subject, message, captchaToken } = body;

  if (!name || !email || !subject || !message || !captchaToken) {
    return response.status(400).json({ message: 'All fields are required' });
  }

  // Mock contact message processing
  console.log('Contact message received:', { name, email, subject, message });
  
  return response.status(200).json({ 
    message: 'Message sent successfully',
    messageId: 'msg_' + Date.now()
  });
}

// Handle projects endpoints
async function handleProjectsEndpoints(request, response, path) {
  const projectIdMatch = path.match(/\/api\/projects\/([^\/]+)\/interactions/);
  
  if (projectIdMatch) {
    const projectId = projectIdMatch[1];
    
    if (request.method === 'POST') {
      let body = {};
      if (request.headers['content-type']?.includes('application/json')) {
        const chunks = [];
        for await (const chunk of request) {
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString());
      }

      // Mock project interaction tracking
      console.log(`Project interaction recorded for project ${projectId}:`, body);
      
      return response.status(200).json({
        success: true,
        interactionId: 'int_' + Date.now(),
        projectId: projectId
      });
    }
  }

  return response.status(404).json({ message: 'Project endpoint not found' });
}

// Handle password recovery endpoint
async function handleRecoveryEndpoint(request, response, searchParams) {
  if (request.method !== 'POST') {
    return response.status(405).json({ message: "Method not allowed" });
  }

  // Parse request body
  let body = {};
  if (request.headers['content-type']?.includes('application/json')) {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    body = JSON.parse(Buffer.concat(chunks).toString());
  }

  const action = searchParams.get('action');

  if (action === 'forgot') {
    const { email } = body;
    if (!email) return response.status(400).json({ message: "Email is required" });

    try {
      const user = await storage.getUserByEmail(email);
      if (user) {
        // Generate reset token
        const resetToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const expiry = new Date(Date.now() + 3600000); // 1 hour
        
        await storage.updateUserResetToken(user.id, resetToken, expiry);
        console.log(`Reset token for ${email}: ${resetToken}`);
      }
      
      // Always return success to prevent email enumeration
      return response.json({ message: "Password reset instructions sent to your email" });
    } catch (error) {
      console.error('Forgot password error:', error);
      return response.status(500).json({ message: "Failed to process password reset request" });
    }
  }

  if (action === 'reset') {
    const { token, newPassword } = body;
    if (!token || !newPassword) {
      return response.status(400).json({ message: "Token and new password are required" });
    }

    try {
      const user = await storage.getUserByResetToken(token);
      if (!user || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
        return response.status(400).json({ message: "Invalid or expired reset token" });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await storage.resetUserPassword(user.id, hashedPassword);
      
      return response.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error('Reset password error:', error);
      return response.status(500).json({ message: "Failed to reset password" });
    }
  }

  return response.status(400).json({ message: "Invalid action. Use 'forgot' or 'reset'" });
}