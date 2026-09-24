/**
 * Comprehensive Vercel Edge Function handler
 * Implements all required API endpoints for ProjectHub frontend with database integration
 */
import { DatabaseStorage } from './lib/storage.js';
import { describeDbError } from './lib/db.js';
import {
  isEmailConfigured,
  isPasswordResetEmailConfigured,
  isPublicEmailConfigured,
  sendPasswordResetEmail,
  sendPublicEmail,
  resolveOrigin,
  contactRecipient,
  passwordResetEmail,
  contactNotificationEmail,
  createResetToken,
  hashResetToken,
} from './lib/email.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import {
  signSessionToken,
  readSessionToken,
  publicUser,
  parseCookies,
  sessionCookie,
  clearedSessionCookie,
  sessionTokenFrom,
} from './lib/session-token.js';

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

/**
 * Marks a response as private.
 *
 * Vercel's default for a function response is `public, max-age=0,
 * must-revalidate`, which lets a shared CDN cache it. Auth responses are
 * per-visitor, so caching one publicly can serve a signed-in body to the next
 * anonymous caller (or vice versa) — the root of the "logged in but the app
 * does not recognise me" report after a Discord redirect. Every endpoint that
 * reads or writes identity is therefore explicitly `no-store`.
 */
function markPrivate(response) {
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Vary', 'Cookie, Authorization, X-User-Session');
}

/**
 * Public-page responses may be cached briefly at the edge; private ones may not.
 * A no-op for anything that already called `markPrivate`.
 */
function markPublic(response, seconds = 60) {
  if (!response.getHeader?.('Cache-Control')) {
    response.setHeader('Cache-Control', `public, max-age=0, s-maxage=${seconds}, must-revalidate`);
  }
}

/**
 * Records a safe diagnostic line for an authentication attempt.
 *
 * Only identifiers that are already non-secret are emitted; tokens, secrets,
 * authorization codes and cookies are never passed here.
 */
function logAuth(event, fields = {}) {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  console.log(`[auth] ${event}${parts.length ? ` ${parts.join(' ')}` : ''}`);
}

/**
 * The user shape sent to the client is defined alongside the session token in
 * ./lib/session-token.js so every backend returns the same fields.
 */

/**
 * How long a password-reset token stays valid.
 *
 * Only the SHA-256 hash is stored, so a token read out of the database cannot be
 * replayed. One hour is short enough that a leaked email is of limited use.
 */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

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

  // Identity-bearing endpoints must never be cached by a shared cache. The
  // default Vercel policy is `public, max-age=0, must-revalidate`, which a CDN
  // may still store and replay across visitors.
  const isAuthPath =
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/admin/') ||
    path === '/api/project-requests';
  if (isAuthPath) markPrivate(response);

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
          // Reported per transport: password reset runs on Mailjet, public
          // mail on Resend, so one being missing must not read as the other.
          email: isEmailConfigured() ? 'configured' : 'not_configured',
          emailProviders: {
            passwordReset: isPasswordResetEmailConfigured() ? 'mailjet' : 'not_configured',
            public: isPublicEmailConfigured() ? 'resend' : 'not_configured',
          },
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

    // OAuth callback paths must resolve before the generic `/api/auth/`
    // catch-all below, which would otherwise answer them with
    // "Auth endpoint not found". This ordering is what silently broke the
    // Discord handshake: Discord redirected to /api/auth/discord/callback with
    // a valid `code`, but no handler ran, so no session was ever established.
    if (path === '/api/auth/discord/callback') {
      return handleDiscordCallback(request, response);
    }
    if (path === '/api/auth/discord') {
      return handleDiscordStart(request, response);
    }
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
      markPublic(response);
      return handleProjectsListEndpoint(request, response);
    }

    // Projects detail + interactions endpoints
    if (path.startsWith('/api/projects/')) {
      return handleProjectsEndpoints(request, response, path, searchParams);
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

/** Signed OAuth `state`, mirrored in a cookie as a fallback to the query param. */
const DISCORD_STATE_COOKIE = 'discord_oauth_state';

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

function parseRequestCookies(request) {
  return parseCookies(request.headers?.cookie || '');
}

/** Appends a `Set-Cookie` value without clobbering one already queued. */
function appendCookie(response, value) {
  const existing = response.getHeader?.('Set-Cookie');
  const list = existing
    ? Array.isArray(existing)
      ? [...existing, value]
      : [existing, value]
    : [value];
  response.setHeader('Set-Cookie', list);
}

/**
 * Sets one cookie on the response.
 *
 * A signed session token is written as the `projecthub_session` cookie so a
 * top-level OAuth redirect — Discord sends the browser straight to the callback
 * — carries the session into the next document, where a URL fragment would not.
 */
function setSessionCookie(response, token) {
  appendCookie(response, sessionCookie(token));
}

/** Removes the session cookie so a logout cannot be replayed from it. */
function clearVisitorCookie(response) {
  appendCookie(response, clearedSessionCookie());
}

/** Sets a short-lived helper cookie for the OAuth handshake. */
function setHelperCookie(response, name, value, maxAgeSeconds) {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (process.env.APP_ORIGIN?.startsWith('https') || process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }
  appendCookie(response, `${name}=${encodeURIComponent(value)}; ${attributes.join('; ')}`);
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

/**
 * Discord avatar URL derived from the id and avatar hash.
 *
 * `profile.avatar` is Discord's own hash, not a user-supplied string, so the
 * URL is computed here rather than trusting anything from the client.
 */
function discordAvatarUrl(profile) {
  if (!profile.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`;
}

function handleDiscordStart(request, response) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    logAuth('discord.start', { outcome: 'not_configured' });
    return response.status(503).json({ message: 'Discord login is not configured' });
  }

  const redirectUri = discordRedirectUri();
  if (!isAbsoluteDiscordRedirect(redirectUri)) {
    // A relative or empty redirect_uri can never match Discord's allow-list.
    logAuth('discord.start', { outcome: 'redirect_not_configured', redirectUri: redirectUri || '(empty)' });
    return response.redirect('/login?discord=error&reason=redirect_not_configured');
  }

  const { verifier, challenge } = createPkcePair();
  setHelperCookie(response, DISCORD_VERIFIER_COOKIE, verifier, 600);

  // `state` is a signed nonce so the callback can reject a handshake this
  // deployment did not initiate (CSRF protection for the OAuth flow). It is
  // mirrored in a cookie so the value is still available if Discord's redirect
  // drops query parameters a proxy rewrote.
  const state = signSessionToken({
    id: `discord:${Date.now()}`,
    email: null,
    firstName: null,
    lastName: null,
  });
  setHelperCookie(response, DISCORD_STATE_COOKIE, state, 600);

  const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'identify email');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  logAuth('discord.start', { outcome: 'redirect', redirectUri, scope: 'identify email' });
  return response.redirect(authorizeUrl.toString());
}

async function handleDiscordCallback(request, response) {
  const searchParams = new URL(request.url, `https://${request.headers.host}`).searchParams;
  const cookies = parseRequestCookies(request);

  // Every exit below logs a safe, non-secret diagnostic. These branches used to
  // redirect in silence, so a rotated secret or a misconfigured callback
  // produced no server output and the only clue was the browser URL.
  const fail = (reason, detail) => {
    logAuth('discord.callback', { outcome: 'failed', reason, detail });
    return response.redirect(`/login?discord=error&reason=${encodeURIComponent(reason)}`);
  };

  logAuth('discord.callback', { outcome: 'reached', code: Boolean(searchParams.get('code')) });

  const oauthError = searchParams.get('error');
  if (oauthError) {
    return fail(oauthError, searchParams.get('error_description') || '');
  }

  const code = searchParams.get('code');
  // The state may arrive in the query (normal) or only in the cookie (if a
  // proxy stripped it); either proof that this deployment started the handshake
  // is accepted, and both are signed.
  const state = searchParams.get('state') || cookies[DISCORD_STATE_COOKIE];
  if (!code) return fail('missing_code');
  if (!state || !readSessionToken(state)) {
    return fail('invalid_state', 'state missing, unsigned, or expired');
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fail('not_configured', `clientId=${Boolean(clientId)} clientSecret=${Boolean(clientSecret)}`);
  }

  const redirectUri = discordRedirectUri();
  if (!isAbsoluteDiscordRedirect(redirectUri)) {
    return fail('redirect_not_configured', `resolved redirect_uri=${redirectUri || '(empty)'}`);
  }

  const codeVerifier = cookies[DISCORD_VERIFIER_COOKIE];
  if (!codeVerifier) {
    return fail('missing_verifier', 'PKCE cookie absent: sign-in began in another browser or tab');
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
      return fail(
        'token_exchange',
        `status=${tokenRes.status} error=${detail.error || 'n/a'} description=${detail.error_description || 'n/a'}`,
      );
    }

    const { access_token: accessToken } = await tokenRes.json();

    const profileRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      return fail('profile', `users/@me returned ${profileRes.status}`);
    }

    const profile = await profileRes.json();
    const displayName = profile.global_name || profile.username || 'Discord User';

    // Match on the immutable Discord id first, then fall back to email so an
    // existing password account gets linked instead of duplicated. Without the
    // id lookup first, every callback created a new row.
    let user = await storage.getUserBySocialId('discord', profile.id);
    const matchedBy = user ? 'discord_id' : null;
    if (!user && profile.email) {
      user = await storage.getUserByEmail(profile.email);
    }

    if (user) {
      logAuth('discord.user_lookup', {
        outcome: 'existing',
        matchedBy: matchedBy || 'email',
        userId: user.id,
      });
      user = await storage.upsertUser({
        id: user.id,
        discordId: profile.id,
        profileImageUrl: user.profileImageUrl || discordAvatarUrl(profile),
      });
    } else {
      logAuth('discord.user_lookup', { outcome: 'create' });
      user = await storage.upsertUser({
        email: profile.email || null,
        firstName: displayName,
        lastName: '',
        discordId: profile.id,
        profileImageUrl: discordAvatarUrl(profile),
      });
    }

    if (!user?.id) {
      return fail('user_upsert', 'the local user could not be created or resolved');
    }

    // Establish the same session a password login does: a signed token. It is
    // written to an HttpOnly cookie *and* handed to the client so whichever
    // transport the next request uses resolves to this same user.
    const sessionToken = signSessionToken(user);
    setSessionCookie(response, sessionToken);
    // The PKCE/state cookies have served their purpose; drop them.
    setHelperCookie(response, DISCORD_VERIFIER_COOKIE, '', 0);
    setHelperCookie(response, DISCORD_STATE_COOKIE, '', 0);

    logAuth('discord.session', {
      outcome: 'created',
      userId: user.id,
      redirectTo: '/dashboard',
    });

    return response.redirect('/dashboard');
  } catch (error) {
    logAuth('discord.callback', { outcome: 'unexpected', detail: error.message });
    return response.redirect('/login?discord=error&reason=unexpected');
  }
}

// Handle authentication-related endpoints with database integration
async function handleAuthEndpoints(request, response, path) {
  const endpoint = path.replace('/api/auth/', '');
  
  switch (endpoint) {
    case 'me':
      if (request.method === 'GET') {
        // The token may arrive as the SPA header or as the cookie the OAuth
        // callback set; both are the same signed session.
        const sessionToken = sessionTokenFrom(request.headers);
        if (!sessionToken) {
          return response.status(401).json({ message: 'Not authenticated' });
        }

        const userData = readSessionToken(sessionToken);
        if (!userData?.id) {
          logAuth('me', { outcome: 'invalid_token' });
          return response.status(401).json({ message: 'Not authenticated' });
        }

        try {
          const user = await storage.getUser(userData.id);
          if (!user) {
            // The token is valid but the account is gone; drop the cookie so the
            // browser is not left replaying a dead session.
            clearVisitorCookie(response);
            return response.status(401).json({ message: 'Not authenticated' });
          }
          if (user.isBlocked) {
            clearVisitorCookie(response);
            return response.status(401).json({ message: 'Your account has been blocked' });
          }
          logAuth('me', { outcome: 'authenticated', userId: user.id });
          return response.status(200).json({ user: publicUser(user) });
        } catch (error) {
          console.error('Auth me lookup failed:', error.message);
          return response.status(503).json({ message: 'Service temporarily unavailable' });
        }
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
            logAuth('login', { outcome: 'blocked' });
            return response.status(403).json({ message: 'Your account has been blocked' });
          }
          if (user && user.password) {
            // Verify password
            const isValidPassword = await bcrypt.compare(password, user.password);
            if (isValidPassword) {
              const sessionToken = signSessionToken(user);
              setSessionCookie(response, sessionToken);
              logAuth('login', { outcome: 'success', userId: user.id });
              return response.status(200).json({ user: publicUser(user), sessionToken });
            }
          }

          logAuth('login', { outcome: 'invalid_credentials' });
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

          const sessionToken = signSessionToken(newUser);
          setSessionCookie(response, sessionToken);
          logAuth('register', { outcome: 'success', userId: newUser.id });
          return response.status(201).json({
            user: publicUser(newUser),
            sessionToken,
          });
        } catch (error) {
          console.error('Registration error:', error);
          return response.status(500).json({ message: describeDbError(error) });
        }
      }
      break;

    case 'logout':
      if (request.method === 'POST') {
        // The signed token cannot be revoked server-side (there is no session
        // table for visitor sessions), so logout must at minimum remove the
        // cookie; the client discards its header token. Clearing the cookie is
        // what stops an OAuth-established session from being replayed.
        clearVisitorCookie(response);
        logAuth('logout', { outcome: 'cleared' });
        return response.status(200).json({ message: 'Logged out successfully' });
      }
      break;

    case 'user':
      if (request.method === 'PATCH') {
        const body = await readJsonBody(request);

        // Check for session token (header or OAuth cookie)
        const userData = readSessionToken(sessionTokenFrom(request.headers));
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

          return response.status(200).json({ user: publicUser(updatedUser) });
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
    // Identity comes from the header or the OAuth cookie.
    const userData = readSessionToken(sessionTokenFrom(request.headers));
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

    const userData = readSessionToken(sessionTokenFrom(request.headers));
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
  const ownerEmail = contactRecipient();

  const { subject: mailSubject, html } = contactNotificationEmail({
    name,
    email,
    subject,
    message,
  });

  // Public/contact mail still goes through Resend; only password reset moved
  // to Mailjet.
  const result = await sendPublicEmail({
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

  // Mirror the delivered message into the Admin Mail inbox.
  //
  // Resend sending an email does not by itself put anything in the dashboard, so
  // the submission is also recorded locally. This runs after the send and never
  // affects its outcome: if the mailbox write fails the contact form still
  // reports success, because the email really was delivered.
  try {
    const { ingestMessage, createMailNotifications } = await import('./lib/mail-store.js');
    const ingested = await ingestMessage({
      // Resend's message id is the idempotency key, so a retried submission
      // cannot appear twice.
      providerMessageId: result.id ? `resend-${result.id}` : null,
      direction: 'inbound',
      status: 'received',
      fromName: name,
      fromEmail: email,
      to: [ownerEmail],
      replyTo: email,
      subject: mailSubject,
      bodyHtml: html,
      bodyText: message,
      provider: 'resend',
      sourceType: 'contact',
      sourceId: result.id || null,
      sentAt: new Date(),
    });

    if (!ingested.duplicate) {
      await createMailNotifications({
        type: 'new_email',
        title: mailSubject,
        preview: message,
        messageId: ingested.id,
        threadId: ingested.threadId,
      });
    }
  } catch (error) {
    // Never fail the public form because the dashboard copy could not be stored.
    console.error('Contact form inbox mirror failed:', error.message);
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
    const sessionUser = readSessionToken(sessionTokenFrom(request.headers));

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

    const emailError = emailProblem(email);
    if (emailError) {
      return response.status(400).json({ message: emailError });
    }

    // The sign-in page sends a Turnstile token with this form; verifying it
    // keeps the recovery flow consistent with login/register instead of
    // silently trusting an unverified caller.
    if (!(await verifyTurnstile(captchaToken, request.headers['x-forwarded-for']))) {
      return response.status(400).json({ message: 'Captcha verification failed' });
    }

    try {
      const user = await storage.getUserByEmail(email);
      if (user) {
        // Only a hash of the token is persisted: a leaked row cannot be
        // replayed against the reset endpoint. The raw token exists only in the
        // email and the link below.
        const resetToken = createResetToken();
        const expiry = new Date(Date.now() + RESET_TOKEN_TTL_MS);

        await storage.updateUserResetToken(user.id, hashResetToken(resetToken), expiry);

        const origin = resolveOrigin(request);
        const resetUrl = origin
          ? `${origin}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(resetToken)}`
          : null;
        const { subject, html, text } = passwordResetEmail(resetToken, resetUrl);

        const result = await sendPasswordResetEmail({ to: email, subject, html, text });

        logAuth('recovery.forgot', {
          outcome: result.sent ? 'sent' : 'send_failed',
          provider: 'mailjet',
          mailjetStatus: result.status,
          mailjetError: result.errorCode,
        });

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
      } else {
        logAuth('recovery.forgot', { outcome: 'no_account' });
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
      const user = await storage.getUserByResetToken(hashResetToken(token));
      if (!user || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
        logAuth('recovery.reset', { outcome: 'invalid_or_expired' });
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
      // resetUserPassword also nulls resetToken/resetTokenExpiry, so the token
      // is single-use: a second submission fails the lookup above.
      await storage.resetUserPassword(user.id, hashedPassword);

      logAuth('recovery.reset', { outcome: 'success', userId: user.id });
      return response.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error('Reset password error:', error);
      return response.status(500).json({ message: "Failed to reset password" });
    }
  }

  return response.status(400).json({ message: "Invalid action. Use 'forgot' or 'reset'" });
}