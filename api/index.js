/**
 * Comprehensive Vercel Edge Function handler
 * Implements all required API endpoints for ProjectHub frontend with database integration
 */
import { DatabaseStorage } from './lib/storage.js';
import { describeDbError } from './lib/db.js';
import {
  isEmailConfigured,
  sendEmail,
  appOrigin,
  passwordResetEmail,
  contactNotificationEmail,
} from './lib/email.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

// Server-side email validation. The form validates too, but the browser is
// trivially bypassed, so this is the check that actually holds.
const EMAIL_PATTERN = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const BLOCKED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'invalid.com',
  'localhost',
]);

/** Returns an error message, or null when the address is acceptable. */
function emailProblem(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Email is required';
  const email = value.trim();
  if (email.length > 254) return 'Email address is too long';
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address';

  const [local, domain] = email.split('@');
  if (local.length > 64) return 'Email address is too long';
  if (local.includes('..') || domain.includes('..')) return 'Enter a valid email address';
  if (BLOCKED_EMAIL_DOMAINS.has(domain.toLowerCase())) return 'Please use a real email address';
  return null;
}

// Password rules enforced on register and reset. Kept in step with
// client/src/lib/password-validation.ts; the form is not a security boundary.
const PASSWORD_MIN_LENGTH = 8;
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'letmein',
  'welcome',
  'admin123',
  'iloveyou',
  'monkey123',
  'dragon123',
  'football1',
  'abc12345',
  'passw0rd',
  'projecthub',
]);

/** Returns an error message, or null when the password is acceptable. */
function passwordProblem(value) {
  if (typeof value !== 'string' || !value) return 'Password is required';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    return 'That password is too common; choose something less predictable';
  }

  const missing = [];
  if (!/[a-z]/.test(value)) missing.push('a lowercase letter');
  if (!/[A-Z]/.test(value)) missing.push('an uppercase letter');
  if (!/[0-9]/.test(value)) missing.push('a number');
  if (!/[^A-Za-z0-9]/.test(value)) missing.push('a special character');
  if (/\s/.test(value)) missing.push('no spaces');

  if (missing.length) return `Password must include ${missing.join(', ')}`;
  return null;
}

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
 * How long a signed session token stays valid.
 *
 * Without this the tokens were valid forever: a token copied out of a browser
 * could be replayed indefinitely, and there was no way to expire a session
 * short of rotating SESSION_SECRET (which invalidates every user at once).
 */
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_DAYS || 30) * 24 * 60 * 60 * 1000;

/**
 * Session tokens are an HMAC-signed payload, not a raw base64 blob.
 *
 * The old format was `base64(JSON)` that anyone could mint for an arbitrary
 * user id; signing it makes the token unforgeable without the server secret.
 * The expiry is inside the signed payload so it cannot be extended by editing
 * the token.
 */
function signSessionToken(user) {
  const issuedAt = Date.now();
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_MS,
  })).toString('base64url');

  return `${payload}.${hmac(payload)}`;
}

/**
 * Returns the token payload, or null when the token is missing, tampered with
 * or expired.
 */
function readSessionToken(token) {
  if (!token || typeof token !== 'string') return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = hmac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    // A signature proves we issued the payload, not that it is still current.
    if (typeof parsed?.exp !== 'number' || Date.now() > parsed.exp) return null;
    return parsed;
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

    // The sign-in page posts to /api/auth/forgot-password and
    // /api/auth/reset-password, but only /api/auth/recovery?action=... was ever
    // implemented, so both forms 404'd with "Auth endpoint not found". Map the
    // flat routes onto the same handler instead of leaving them dead.
    if (path === '/api/auth/forgot-password') {
      return handleRecoveryEndpoint(request, response, new URLSearchParams({ action: 'forgot' }));
    }
    if (path === '/api/auth/reset-password') {
      return handleRecoveryEndpoint(request, response, new URLSearchParams({ action: 'reset' }));
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
      return handleProjectsEndpoints(request, response, path, searchParams);
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

/** Name of the short-lived cookie that carries the PKCE verifier between the
 *  authorize redirect and the callback. */
const DISCORD_VERIFIER_COOKIE = 'discord_code_verifier';

function discordRedirectUri() {
  return (
    process.env.DISCORD_CALLBACK_URL ||
    (process.env.APP_ORIGIN ? `${process.env.APP_ORIGIN}/api/auth/discord/callback` : '')
  );
}

/** True for a callback URL Discord can actually match against its allow-list. */
function isAbsoluteDiscordRedirect(uri) {
  return /^https?:\/\/[^/]+/i.test(uri || '');
}

function parseCookies(request) {
  const header = request.headers?.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return cookies;
}

function setCookie(response, name, value, maxAgeSeconds) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.APP_ORIGIN?.startsWith('https') || process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }
  response.setHeader('Set-Cookie', attributes.join('; '));
}

/**
 * Discord requires PKCE (the S256 challenge) on the authorization code
 * exchange. Without it the token endpoint rejects the request, and Discord
 * reports that rejection as a bare 401, which is what the callback used to log.
 */
function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
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

  const redirectUri = discordRedirectUri();
  if (!isAbsoluteDiscordRedirect(redirectUri)) {
    // A relative or empty redirect_uri can never match Discord's allow-list.
    return response.redirect('/login?discord=error&reason=redirect_not_configured');
  }

  const { verifier, challenge } = createPkcePair();
  setCookie(response, DISCORD_VERIFIER_COOKIE, verifier, 600);

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
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'identify email');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

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

  const redirectUri = discordRedirectUri();
  if (!isAbsoluteDiscordRedirect(redirectUri)) {
    return response.redirect('/login?discord=error&reason=redirect_not_configured');
  }

  const codeVerifier = parseCookies(request)[DISCORD_VERIFIER_COOKIE];
  if (!codeVerifier) {
    return response.redirect('/login?discord=error&reason=missing_verifier');
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
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      // Discord's error body (error/error_description) says whether the cause
      // is the secret, the redirect URI or the verifier. The request body is
      // never logged: it carries client_secret.
      const detail = await tokenRes.json().catch(() => ({}));
      console.error('Discord token exchange failed:', tokenRes.status, detail.error, detail.error_description);
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
          return response.status(500).json({ message: describeDbError(error) });
        }
      }
      break;

    case 'register':
      if (request.method === 'POST') {
        const { email, password, firstName, lastName, captchaToken } = await readJsonBody(request);

        if (!email || !password || !firstName || !lastName) {
          return response.status(400).json({ message: 'All fields are required' });
        }

        const passwordError = passwordProblem(password);
        if (passwordError) {
          return response.status(400).json({ message: passwordError });
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
          return response.status(500).json({ message: describeDbError(error) });
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

  const emailError = emailProblem(email);
  if (emailError) {
    return response.status(400).json({ message: emailError });
  }

  if (!(await verifyTurnstile(captchaToken, request.headers['x-forwarded-for']))) {
    return response.status(400).json({ message: 'Captcha verification failed' });
  }

  // This endpoint used to log the message and return a fabricated messageId, so
  // the form reported success while nothing was ever delivered. Send it for
  // real and surface a failure instead of inventing one.
  const ownerEmail = process.env.CONTACT_TO_EMAIL || process.env.OWNER_EMAIL;
  if (!ownerEmail) {
    console.error('Contact form not sent: CONTACT_TO_EMAIL is not configured');
    return response.status(502).json({ message: 'Contact form is not configured on the server' });
  }

  const { subject: mailSubject, html } = contactNotificationEmail({
    name,
    email,
    subject,
    message,
  });

  const result = await sendEmail({
    to: ownerEmail,
    subject: mailSubject,
    html,
    replyTo: email,
  });

  if (!result.sent) {
    const reason =
      result.reason === 'not_configured'
        ? 'Email is not configured on the server'
        : 'Failed to send your message';
    return response.status(502).json({ message: reason });
  }

  return response.status(200).json({ message: 'Message sent successfully' });
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
async function handleProjectsEndpoints(request, response, path, searchParams) {
  // GET/POST /api/projects/:slug/interactions
  //
  // Likes and ratings are per-user rows in project_interactions; the id in the
  // path may be the project's UUID or its slug, so it is resolved first.
  const interactionsMatch = path.match(/^\/api\/projects\/([^\/]+)\/interactions$/);
  if (interactionsMatch) {
    const projectRef = interactionsMatch[1];
    const sessionUser = readSessionToken(request.headers['x-user-session']);

    try {
      const project = await storage.resolveVerifiedProject(projectRef);
      if (!project) {
        return response.status(404).json({ message: 'Project not found' });
      }

      if (request.method === 'GET') {
        const stats = await storage.getProjectInteractions(project.id);
        const userInteraction = sessionUser?.id
          ? await storage.getUserInteraction(project.id, sessionUser.id)
          : null;

        return response.status(200).json({
          ...stats,
          userInteraction: userInteraction
            ? { isLiked: userInteraction.isLiked, rating: userInteraction.rating }
            : null,
        });
      }

      if (request.method === 'POST') {
        if (!sessionUser?.id) {
          return response.status(401).json({ message: 'You must be logged in to like or rate projects' });
        }

        const body = await readJsonBody(request);
        const update = {};

        if (body.isLiked !== undefined) {
          if (typeof body.isLiked !== 'boolean') {
            return response.status(400).json({ message: 'isLiked must be a boolean' });
          }
          update.isLiked = body.isLiked;
        }

        if (body.rating !== undefined && body.rating !== null) {
          const rating = Number(body.rating);
          // 1-5 is the "premium" range the client renders as stars.
          if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return response.status(400).json({ message: 'rating must be an integer between 1 and 5' });
          }
          update.rating = rating;
        }

        if (Object.keys(update).length === 0) {
          return response.status(400).json({ message: 'isLiked or rating is required' });
        }

        await storage.upsertProjectInteraction({
          projectId: project.id,
          userId: sessionUser.id,
          ...update,
        });

        const stats = await storage.getProjectInteractions(project.id);
        const userInteraction = await storage.getUserInteraction(project.id, sessionUser.id);

        return response.status(200).json({
          ...stats,
          userInteraction: userInteraction
            ? { isLiked: userInteraction.isLiked, rating: userInteraction.rating }
            : null,
        });
      }

      return response.status(405).json({ message: 'Method not allowed' });
    } catch (error) {
      console.error('Project interaction error:', error);
      return response.status(500).json({ message: 'Failed to record project interaction' });
    }
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
    const { email, captchaToken } = body;
    if (!email) return response.status(400).json({ message: "Email is required" });

    // The sign-in page sends a Turnstile token with this form; verifying it
    // keeps the recovery flow consistent with login/register instead of
    // silently trusting an unverified caller.
    if (!(await verifyTurnstile(captchaToken, request.headers['x-forwarded-for']))) {
      return response.status(400).json({ message: 'Captcha verification failed' });
    }

    try {
      const user = await storage.getUserByEmail(email);
      if (user) {
        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiry = new Date(Date.now() + 3600000); // 1 hour

        await storage.updateUserResetToken(user.id, resetToken, expiry);

        const resetUrl = `${appOrigin()}/reset-password?email=${encodeURIComponent(
          email,
        )}&token=${encodeURIComponent(resetToken)}`;
        const { subject, html, text } = passwordResetEmail(resetToken, resetUrl);

        const result = await sendEmail({ to: email, subject, html, text });

        // This endpoint used to rotate the token and return a success message
        // without sending anything, so the sign-in page reported "instructions
        // sent" while no mail existed. Report a real failure when the send does
        // not happen. The response stays deliberately vague only when the
        // account lookup found nothing.
        if (!result.sent) {
          const reason =
            result.reason === 'not_configured'
              ? 'Email is not configured on the server'
              : 'Failed to send the reset email';
          return response.status(502).json({ message: reason });
        }
      }
      
      // Always return success to prevent email enumeration
      return response.json({ message: "Password reset instructions sent to your email" });
    } catch (error) {
      console.error('Forgot password error:', error);
      return response.status(500).json({ message: "Failed to process password reset request" });
    }
  }

  if (action === 'reset') {
    const { token, newPassword, email } = body;
    if (!token || !newPassword) {
      return response.status(400).json({ message: "Token and new password are required" });
    }

    // Matches the minimum the sign-in page enforces, so the two forms agree.
    if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN_LENGTH) {
      return response.status(400).json({ message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long` });
    }

    const resetPasswordError = passwordProblem(newPassword);
    if (resetPasswordError) {
      return response.status(400).json({ message: resetPasswordError });
    }

    try {
      const user = await storage.getUserByResetToken(token);
      if (!user || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
        return response.status(400).json({ message: "Invalid or expired reset token" });
      }

      // The reset page collects the account email alongside the code, so bind
      // it when present: a token should not be usable for a different account.
      // It stays optional because the emailed link carries the token alone.
      if (email && user.email && String(email).toLowerCase() !== user.email.toLowerCase()) {
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