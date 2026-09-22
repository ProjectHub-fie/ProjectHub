/**
 * Comprehensive Vercel Edge Function handler
 * Implements all required API endpoints for ProjectHub frontend with database integration
 */
import { DatabaseStorage } from './lib/storage.js';
import { describeDbError } from './lib/db.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

// Initialize database storage
const storage = new DatabaseStorage();

// Origins allowed to call the API with credentials. A blanket `*` combined with
// Access-Control-Allow-Credentials is rejected by browsers and would let any
// site replay a visitor's admin session cookie, so the caller's origin is
// echoed back only when it is explicitly allowed.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || origin === process.env.APP_ORIGIN)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
  }

  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Session');
}

function hmac(value) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET must be set');
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

/**
 * Session tokens are an HMAC-signed payload, not a raw base64 blob.
 *
 * The old format was `base64(JSON)` that anyone could mint for an arbitrary
 * user id; signing it makes the token unforgeable without the server secret.
 */
function signSessionToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  })).toString('base64url');

  return `${payload}.${hmac(payload)}`;
}

/** Returns the token payload, or null when the token is missing or tampered with. */
function readSessionToken(token) {
  if (!token || typeof token !== 'string') return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = hmac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
}

async function readJsonBody(request) {
  if (!request.headers['content-type']?.includes('application/json')) return {};
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

/** Confirms a Cloudflare Turnstile token when the feature is configured. */
async function verifyTurnstile(captchaToken, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Captcha not configured: treat as disabled.

  const body = new URLSearchParams({ secret, response: captchaToken || '' });
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch (error) {
    console.error('Turnstile verification error:', error.message);
    return false;
  }
}

export default async function handler(request, response) {
  const url = new URL(request.url, `https://${request.headers.host}`);
  const path = url.pathname;
  const searchParams = url.searchParams;

  // Enable CORS for all API endpoints
  applyCors(request, response);
  
  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  try {
    // Health check endpoint.
    //
    // This reports the database as well as the process. Previously it returned
    // 200 unconditionally, so a deployment whose DATABASE_URL did not work
    // still looked healthy while every query failed with 28P01/28P01-style
    // errors. A health check that cannot fail is of no use for diagnosing that.
    if (path === '/api/health') {
      try {
        await storage.checkConnection();
        return response.status(200).json({
          status: 'ok',
          database: 'connected',
          timestamp: new Date().toISOString(),
          message: 'API is functioning properly'
        });
      } catch (error) {
        console.error('Health check database failure:', error);
        return response.status(503).json({
          status: 'error',
          database: 'unavailable',
          timestamp: new Date().toISOString(),
          message: describeDbError(error)
        });
      }
    }

    // Password recovery endpoint (handle this before auth endpoints)
    if (path === '/api/auth/recovery') {
      return handleRecoveryEndpoint(request, response, searchParams);
    }

    // Discord OAuth: begin and complete the handshake.
    if (path === '/api/auth/discord') {
      return handleDiscordStart(request, response);
    }
    if (path === '/api/auth/discord/callback') {
      return handleDiscordCallback(request, response);
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

    // Projects list endpoint
    if (path === '/api/projects') {
      return handleProjectsListEndpoint(request, response);
    }

    // Projects detail + interactions endpoints
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
        "GET /api/projects",
        "GET /api/projects/:slug",
        "POST /api/auth/login",
        "POST /api/auth/register", 
        "POST /api/auth/logout",
        "GET /api/auth/me",
        "PATCH /api/auth/user",
        "POST /api/project-requests",
        "GET /api/project-requests",
        "POST /api/contact",
        "POST /api/projects/:id/interactions",
        "POST /api/auth/recovery?action=forgot",
        "POST /api/auth/recovery?action=reset",
        "GET /api/auth/discord",
        "GET /api/auth/discord/callback"
      ]
    });

  } catch (error) {
    // Raw driver errors carry the SQL text, bound parameters and connection
    // string; they are logged here but never returned to the caller.
    console.error('API handler error:', error);
    return response.status(500).json({ message: "Internal server error" });
  }
}

/* -------------------------------------------------------------------------
   Discord OAuth2
   GET /api/auth/discord          -> redirect to Discord's authorize screen
   GET /api/auth/discord/callback -> exchange code, upsert the user, sign in
------------------------------------------------------------------------- */

const DISCORD_API = 'https://discord.com/api/v10';

function discordRedirectUri() {
  return (
    process.env.DISCORD_CALLBACK_URL ||
    `${process.env.APP_ORIGIN || ''}/api/auth/discord/callback`
  );
}

function discordAvatarUrl(profile) {
  if (!profile.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`;
}

function handleDiscordStart(request, response) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return response.status(503).json({ message: 'Discord login is not configured' });
  }

  // `state` is a signed nonce so the callback can reject a handshake this
  // deployment did not initiate (CSRF protection for the OAuth flow).
  const state = signSessionToken({
    id: `discord:${Date.now()}`,
    email: null,
    firstName: null,
    lastName: null,
  });

  const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', discordRedirectUri());
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'identify email');
  authorizeUrl.searchParams.set('state', state);

  return response.redirect(authorizeUrl.toString());
}

async function handleDiscordCallback(request, response) {
  const searchParams = new URL(request.url, `https://${request.headers.host}`).searchParams;

  const oauthError = searchParams.get('error');
  if (oauthError) {
    return response.redirect(`/login?discord=error&reason=${encodeURIComponent(oauthError)}`);
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (!code) return response.redirect('/login?discord=error&reason=missing_code');
  if (!state || !readSessionToken(state)) {
    return response.redirect('/login?discord=error&reason=invalid_state');
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return response.redirect('/login?discord=error&reason=not_configured');
  }

  try {
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: discordRedirectUri(),
      }),
    });

    if (!tokenRes.ok) {
      console.error('Discord token exchange failed:', tokenRes.status);
      return response.redirect('/login?discord=error&reason=token_exchange');
    }

    const { access_token: accessToken } = await tokenRes.json();

    const profileRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      return response.redirect('/login?discord=error&reason=profile');
    }

    const profile = await profileRes.json();
    const displayName = profile.global_name || profile.username || 'Discord User';

    // Match on the immutable Discord id first, then fall back to email so an
    // existing password account gets linked instead of duplicated.
    let user = await storage.getUserBySocialId('discord', profile.id);
    if (!user && profile.email) {
      user = await storage.getUserByEmail(profile.email);
    }

    if (user) {
      user = await storage.upsertUser({
        id: user.id,
        discordId: profile.id,
        profileImageUrl: user.profileImageUrl || discordAvatarUrl(profile),
      });
    } else {
      user = await storage.upsertUser({
        email: profile.email || null,
        firstName: displayName,
        lastName: '',
        discordId: profile.id,
        profileImageUrl: discordAvatarUrl(profile),
      });
    }

    const sessionToken = signSessionToken(user);
    // The token travels in the URL fragment so it is never sent to the server
    // or logged; the client stores it exactly like a password login.
    return response.redirect(`/login?discord=success#token=${encodeURIComponent(sessionToken)}`);
  } catch (error) {
    console.error('Discord callback error:', error);
    return response.redirect('/login?discord=error&reason=unexpected');
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
          const userData = readSessionToken(sessionToken);

          if (userData?.id) {
            try {
              const user = await storage.getUser(userData.id);
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
            } catch (error) {
              console.error('Auth me lookup failed:', error.message);
              return response.status(503).json({ message: 'Service temporarily unavailable' });
            }
          }
        }
        return response.status(401).json({ message: 'Not authenticated' });
      }
      break;

    case 'login':
      if (request.method === 'POST') {
        const { email, password, captchaToken } = await readJsonBody(request);

        if (!email || !password) {
          return response.status(400).json({ message: 'Email and password are required' });
        }

        if (!(await verifyTurnstile(captchaToken, request.headers['x-forwarded-for']))) {
          return response.status(400).json({ message: 'Captcha verification failed' });
        }

        try {
          const user = await storage.getUserByEmail(email);
          if (user?.isBlocked) {
            return response.status(403).json({ message: 'Your account has been blocked' });
          }
          if (user && user.password) {
            // Verify password
            const isValidPassword = await bcrypt.compare(password, user.password);
            if (isValidPassword) {
              return response.status(200).json({
                user: {
                  id: user.id,
                  email: user.email,
                  firstName: user.firstName,
                  lastName: user.lastName,
                  profileImageUrl: user.profileImageUrl
                },
                sessionToken: signSessionToken(user)
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
        const { email, password, firstName, lastName, captchaToken } = await readJsonBody(request);

        if (!email || !password || !firstName || !lastName) {
          return response.status(400).json({ message: 'All fields are required' });
        }

        if (!(await verifyTurnstile(captchaToken, request.headers['x-forwarded-for']))) {
          return response.status(400).json({ message: 'Captcha verification failed' });
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

          return response.status(201).json({
            user: {
              id: newUser.id,
              email: newUser.email,
              firstName: newUser.firstName,
              lastName: newUser.lastName,
              profileImageUrl: newUser.profileImageUrl
            },
            sessionToken: signSessionToken(newUser)
          });
        } catch (error) {
          console.error('Registration error:', error);
          return response.status(500).json({ message: 'Registration failed' });
        }
      }
      break;

    case 'logout':
      if (request.method === 'POST') {
        // Tokens are stateless; the client discards its own copy.
        return response.status(200).json({ message: 'Logged out successfully' });
      }
      break;

    case 'user':
      if (request.method === 'PATCH') {
        const body = await readJsonBody(request);

        // Check for session token
        const sessionToken = request.headers['x-user-session'];
        const userData = readSessionToken(sessionToken);
        if (!userData?.id) {
          return response.status(401).json({ message: 'Not authenticated' });
        }

        try {
          // Update user
          const updatedUser = await storage.upsertUser({
            id: userData.id,
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

    const userData = readSessionToken(sessionToken);
    if (!userData?.id) {
      return response.status(401).json({ message: 'Not authenticated' });
    }

    try {
      const requests = await storage.getProjectRequests(userData.id);
      return response.status(200).json(requests);
    } catch (error) {
      console.error('Get project requests error:', error);
      return response.status(500).json({ message: 'Failed to fetch project requests' });
    }
  }

  if (request.method === 'POST') {
    const body = await readJsonBody(request);
    const { title, description, budget, timeline, technologies } = body;

    // Validate required fields
    if (!title || !description) {
      return response.status(400).json({ message: 'Title and description are required' });
    }

    const userData = readSessionToken(request.headers['x-user-session']);
    if (!userData?.id) {
      return response.status(401).json({ message: 'Not authenticated' });
    }

    try {
      // Create project request
      const projectRequest = await storage.createProjectRequest({
        userId: userData.id,
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

  const body = await readJsonBody(request);
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

// Handle GET /api/projects - return all active verified projects
async function handleProjectsListEndpoint(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ message: 'Method not allowed' });
  }
  try {
    const projects = await storage.getAllVerifiedProjects();
    return response.status(200).json(projects);
  } catch (error) {
    console.error('Get projects error:', error);
    return response.status(500).json({ message: 'Failed to fetch projects' });
  }
}

// Handle /api/projects/:slug and /api/projects/:id/interactions
async function handleProjectsEndpoints(request, response, path) {
  // POST /api/projects/:id/interactions
  const interactionsMatch = path.match(/^\/api\/projects\/([^\/]+)\/interactions$/);
  if (interactionsMatch) {
    const projectId = interactionsMatch[1];
    if (request.method === 'POST') {
      const body = await readJsonBody(request);
      console.log(`Project interaction recorded for project ${projectId}:`, body);
      return response.status(200).json({
        success: true,
        interactionId: 'int_' + Date.now(),
        projectId: projectId
      });
    }
    return response.status(405).json({ message: 'Method not allowed' });
  }

  // GET /api/projects/:slug
  const slugMatch = path.match(/^\/api\/projects\/([^\/]+)$/);
  if (slugMatch) {
    const slug = slugMatch[1];
    if (request.method === 'GET') {
      try {
        const project = await storage.getVerifiedProjectBySlug(slug);
        if (!project) {
          return response.status(404).json({ message: 'Project not found' });
        }
        return response.status(200).json(project);
      } catch (error) {
        console.error('Get project by slug error:', error);
        return response.status(500).json({ message: 'Failed to fetch project' });
      }
    }
    return response.status(405).json({ message: 'Method not allowed' });
  }

  return response.status(404).json({ message: 'Project endpoint not found' });
}

// Handle password recovery endpoint
async function handleRecoveryEndpoint(request, response, searchParams) {
  if (request.method !== 'POST') {
    return response.status(405).json({ message: "Method not allowed" });
  }

  const body = await readJsonBody(request);
  const action = searchParams.get('action');

  if (action === 'forgot') {
    const { email } = body;
    if (!email) return response.status(400).json({ message: "Email is required" });

    try {
      const user = await storage.getUserByEmail(email);
      if (user) {
        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiry = new Date(Date.now() + 3600000); // 1 hour

        await storage.updateUserResetToken(user.id, resetToken, expiry);
        // The token itself is never logged: it grants account takeover.
        console.log('Password reset token issued for user', user.id);
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